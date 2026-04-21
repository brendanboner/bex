import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { SkillRegistryClient, computeSkillChecksum } from '@bclaw/skill-registry-client';
import { KnowledgeStore } from '@bclaw/knowledge-store';
import { ok, err, ErrorCodes } from '@bclaw/shared';
import type { SkillManifest } from '@bclaw/shared';

/** Write any bundled knowledge docs from a manifest to the local KnowledgeStore. */
async function installKnowledgeDocs(manifest: SkillManifest): Promise<number> {
  const docs = manifest.knowledgeDocs;
  if (!docs || docs.length === 0) return 0;
  const store = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
  await Promise.all(docs.map((d) => store.write(d.domain, d.topic, d.content)));
  return docs.length;
}

/**
 * Merge domain knowledge from a manifest into the local DomainKnowledge table.
 * Playbooks are deduped by name (incoming wins on conflict). Doc index is unchanged
 * (we don't bundle it — URLs are instance-specific). Entity graph is merged shallowly.
 */
async function installDomainKnowledge(manifest: SkillManifest, prisma: PrismaClient): Promise<void> {
  const dk = manifest.domainKnowledge;
  if (!dk) return;
  if (Object.keys(dk.entityGraph).length === 0 && dk.playbooks.length === 0) return;

  const topDomain = manifest.domain.split('.')[0]!;
  const existing = await prisma.domainKnowledge.findUnique({ where: { domain: topDomain } });

  const existingPlaybooks = (existing?.playbooks as Array<Record<string, unknown>> | null) ?? [];
  const existingEntityGraph = (existing?.entityGraph as Record<string, unknown> | null) ?? {};

  // Merge playbooks by name (incoming wins)
  const pbMap = new Map<string, Record<string, unknown>>(
    existingPlaybooks.map((p) => [String(p['name'] ?? ''), p]),
  );
  for (const p of dk.playbooks) {
    if (p['name']) pbMap.set(p['name'] as string, p);
  }
  const mergedPlaybooks = [...pbMap.values()];

  // Merge entity graph shallowly (incoming wins on key conflict)
  const mergedEntityGraph = { ...existingEntityGraph, ...dk.entityGraph };

  await prisma.domainKnowledge.upsert({
    where: { domain: topDomain },
    create: {
      domain: topDomain,
      docIndex: [],
      entityGraph: mergedEntityGraph as Prisma.InputJsonValue,
      playbooks: mergedPlaybooks as Prisma.InputJsonValue,
    },
    update: {
      entityGraph: mergedEntityGraph as Prisma.InputJsonValue,
      playbooks: mergedPlaybooks as Prisma.InputJsonValue,
    },
  });
}

/** Read all knowledge docs for a given domain prefix from the local KnowledgeStore. */
async function readKnowledgeDocsForDomain(skillDomain: string): Promise<SkillManifest['knowledgeDocs']> {
  const store = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
  // Match docs whose domain equals the skill domain or starts with the skill root domain
  // e.g. skill domain "extremecloudiq.devices" → read from "extremecloudiq" prefix
  const rootDomain = skillDomain.split('.')[0] ?? skillDomain;
  const allTopics = await store.list().catch(() => [] as Awaited<ReturnType<typeof store.list>>);
  const matching = allTopics.filter((t) => t.domain === rootDomain || t.domain.startsWith(`${rootDomain}/`));
  if (matching.length === 0) return undefined;

  const docs = await Promise.all(
    matching.map(async (t) => {
      const entry = await store.read(t.domain, t.topic);
      return entry ? { domain: t.domain, topic: t.topic, content: entry.content } : null;
    }),
  );
  return docs.filter((d): d is NonNullable<typeof d> => d !== null);
}

export async function registryRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const client = new SkillRegistryClient();

  // GET /registry/skills — list skills available in the registry (SkillRegistryEntry + remote)
  // Each entry includes isInstalledLocally and isInSync flags.
  // This does NOT include local published skills that haven't been pushed to the registry.
  app.get('/registry/skills', async (request, reply) => {
    const query = (request.query as Record<string, string>)['domain'];

    // 1. Local registry entries (skills that have been pushed from or pulled to this instance)
    const registryEntries = await prisma.skillRegistryEntry.findMany({
      where: query ? { domain: { contains: query } } : {},
      select: { domain: true, version: true, name: true, description: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });

    // 2. Fetch from remote registry if configured
    let remoteSkills: import('@bclaw/skill-registry-client').RemoteSkill[] = [];
    if (client.isConfigured) {
      try {
        remoteSkills = await client.list(query);
      } catch {
        app.log.warn('Remote registry unavailable');
      }
    }

    // 3. Locally installed skills (to check isInstalledLocally / isInSync)
    const localSkills = await prisma.skill.findMany({
      where: { status: 'PUBLISHED' },
      select: { domain: true, version: true },
    });
    const localMap = new Map<string, string>(); // domain → version
    for (const s of localSkills) localMap.set(s.domain, s.version);

    // Build unified registry view: remote first, then local-only registry entries
    const remoteKeys = new Set(remoteSkills.map(s => `${s.domain}:${s.version}`));

    const remoteEntries = remoteSkills.map(s => {
      const localVersion = localMap.get(s.domain);
      return {
        domain: s.domain,
        version: s.version,
        name: s.name,
        description: s.description,
        publishedAt: s.publishedAt,
        isInstalledLocally: localMap.has(s.domain),
        localVersion: localVersion ?? null,
        isInSync: localVersion === s.version,
        source: 'remote' as const,
      };
    });

    // Local registry entries not covered by remote (pushed from this instance but remote may be down)
    const localOnlyEntries = registryEntries
      .filter(e => !remoteKeys.has(`${e.domain}:${e.version}`))
      .map(e => {
        const localVersion = localMap.get(e.domain);
        return {
          domain: e.domain,
          version: e.version,
          name: e.name,
          description: e.description ?? undefined,
          publishedAt: e.publishedAt.toISOString(),
          isInstalledLocally: localMap.has(e.domain),
          localVersion: localVersion ?? null,
          isInSync: localVersion === e.version,
          source: 'local-registry' as const,
        };
      });

    return reply.send(ok([...remoteEntries, ...localOnlyEntries]));
  });

  // GET /registry/skills/:domain/:version — fetch from local registry first, then remote
  app.get<{ Params: { domain: string; version: string } }>(
    '/registry/skills/:domain/:version',
    async (request, reply) => {
      // Check local first
      const local = await prisma.skillRegistryEntry.findUnique({
        where: { domain_version: { domain: request.params.domain, version: request.params.version } },
      });
      if (local) return reply.send(ok(local.manifest));

      // Fall back to remote registry
      try {
        const manifest = await client.fetch(request.params.domain, request.params.version);
        return reply.send(ok(manifest));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.status(404).send(err(ErrorCodes.NOT_FOUND, msg));
      }
    },
  );

  // POST /registry/publish — publish a local skill to the remote registry
  // Also handles incoming publish requests from remote instances (this instance as registry)
  app.post<{ Body: unknown }>('/registry/publish', async (request, reply) => {
    const body = request.body as Partial<SkillManifest>;

    // If we have all required fields, store it locally as a registry entry
    if (body.domain && body.version && body.tools && body.name) {
      const checksum = computeSkillChecksum(body.tools as unknown[], body.systemPrompt);

      await prisma.skillRegistryEntry.upsert({
        where: { domain_version: { domain: body.domain, version: body.version } },
        create: {
          domain: body.domain,
          version: body.version,
          name: body.name,
          description: body.description ?? null,
          manifest: body as Prisma.InputJsonValue,
          registryUrl: null,
        },
        update: {
          name: body.name,
          description: body.description ?? null,
          manifest: body as Prisma.InputJsonValue,
        },
      });

      const manifest: SkillManifest = {
        name: body.name,
        domain: body.domain,
        version: body.version,
        capabilities: (body.capabilities as string[]) ?? [],
        tools: body.tools as unknown[],
        checksum,
        publishedAt: new Date().toISOString(),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
        ...(((request.user as { sub?: string } | undefined)?.sub) !== undefined
          ? { publishedBy: (request.user as { sub: string }).sub }
          : {}),
      };

      // Also forward to upstream registry if configured
      if (client.isConfigured) {
        try {
          await client.publish(manifest);
        } catch {
          // Don't fail if upstream registry is unavailable
          app.log.warn({ domain: body.domain, version: body.version }, 'Failed to forward to upstream registry');
        }
      }

      return reply.status(201).send(ok({
        domain: body.domain,
        version: body.version,
        url: `/registry/skills/${body.domain}/${body.version}`,
        checksum,
      }));
    }

    return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'manifest must include name, domain, version, and tools'));
  });

  // POST /registry/install/:domain/:version — pull a skill from the remote registry and install locally
  app.post<{ Params: { domain: string; version: string } }>(
    '/registry/install/:domain/:version',
    { preHandler: [app.requireSystemUser] },
    async (request, reply) => {
      try {
        const manifest = await client.fetch(request.params.domain, request.params.version);

        // Verify checksum
        if (!client.verify(manifest)) {
          return reply.status(422).send(err(ErrorCodes.VALIDATION_ERROR, 'Skill manifest checksum verification failed'));
        }

        // Install locally as a skill
        const skill = await prisma.skill.upsert({
          where: { domain_version: { domain: manifest.domain, version: manifest.version } },
          create: {
            name: manifest.name,
            domain: manifest.domain,
            version: manifest.version,
            description: manifest.description ?? null,
            capabilities: manifest.capabilities,
            tools: manifest.tools as Prisma.InputJsonValue,
            systemPrompt: manifest.systemPrompt ?? null,
            status: 'PUBLISHED',
          },
          update: {
            name: manifest.name,
            description: manifest.description ?? null,
            tools: manifest.tools as Prisma.InputJsonValue,
            systemPrompt: manifest.systemPrompt ?? null,
            capabilities: manifest.capabilities,
            status: 'PUBLISHED',
          },
        });

        // Record in registry entries table
        await prisma.skillRegistryEntry.upsert({
          where: { domain_version: { domain: manifest.domain, version: manifest.version } },
          create: {
            domain: manifest.domain,
            version: manifest.version,
            name: manifest.name,
            description: manifest.description ?? null,
            manifest: manifest as Prisma.InputJsonValue,
            registryUrl: client['baseUrl'] as string,
          },
          update: {
            manifest: manifest as Prisma.InputJsonValue,
          },
        });

        // Install any bundled knowledge docs
        const docsInstalled = await installKnowledgeDocs(manifest);

        // Merge any bundled domain intelligence (playbooks + entity graph)
        await installDomainKnowledge(manifest, prisma);

        return reply.send(ok({ skillId: skill.id, domain: skill.domain, version: skill.version, docsInstalled }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.status(502).send(err(ErrorCodes.INTERNAL, msg));
      }
    },
  );

  // POST /registry/pull — pull a skill from the remote registry by domain+version in body
  app.post<{ Body: { domain?: string; version?: string } }>(
    '/registry/pull',
    { preHandler: [app.requireSystemUser] },
    async (request, reply) => {
      const { domain, version } = request.body ?? {};

      if (!domain || !version) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'body must include domain and version'));
      }

      try {
        const manifest = await client.fetch(domain, version);

        if (!client.verify(manifest)) {
          return reply.status(422).send(err(ErrorCodes.VALIDATION_ERROR, 'Skill manifest checksum verification failed'));
        }

        const skill = await prisma.skill.upsert({
          where: { domain_version: { domain: manifest.domain, version: manifest.version } },
          create: {
            name: manifest.name,
            domain: manifest.domain,
            version: manifest.version,
            description: manifest.description ?? null,
            capabilities: manifest.capabilities,
            tools: manifest.tools as Prisma.InputJsonValue,
            systemPrompt: manifest.systemPrompt ?? null,
            status: 'PUBLISHED',
          },
          update: {
            name: manifest.name,
            description: manifest.description ?? null,
            tools: manifest.tools as Prisma.InputJsonValue,
            systemPrompt: manifest.systemPrompt ?? null,
            capabilities: manifest.capabilities,
            status: 'PUBLISHED',
          },
        });

        await prisma.skillRegistryEntry.upsert({
          where: { domain_version: { domain: manifest.domain, version: manifest.version } },
          create: {
            domain: manifest.domain,
            version: manifest.version,
            name: manifest.name,
            description: manifest.description ?? null,
            manifest: manifest as Prisma.InputJsonValue,
            registryUrl: client['baseUrl'] as string,
          },
          update: {
            manifest: manifest as Prisma.InputJsonValue,
          },
        });

        // Merge any bundled domain intelligence (playbooks + entity graph)
        await installDomainKnowledge(manifest, prisma);

        return reply.send(ok({ skillId: skill.id, domain: skill.domain, version: skill.version, name: skill.name }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.status(502).send(err(ErrorCodes.INTERNAL, msg));
      }
    },
  );

  // ─── Registry Configuration ────────────────────────────────────────────────

  // GET /registry/config — get the current registry URL config
  app.get('/registry/config', async (_request, reply) => {
    const url = process.env['SKILL_REGISTRY_URL'] ?? '';
    const token = process.env['SKILL_REGISTRY_TOKEN'] ?? '';
    return reply.send(ok({ url, configured: url.length > 0, writeEnabled: url.length > 0 && token.length > 0 }));
  });

  // PUT /registry/config — update the registry URL (writes to process env for the session)
  app.put<{ Body: { url?: string; authToken?: string } }>('/registry/config', async (request, reply) => {
    const { url, authToken } = request.body ?? {};
    if (!url) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'url is required'));
    process.env['SKILL_REGISTRY_URL'] = url;
    if (authToken !== undefined) process.env['SKILL_REGISTRY_TOKEN'] = authToken;
    const writeEnabled = url.length > 0 && (process.env['SKILL_REGISTRY_TOKEN'] ?? '').length > 0;
    return reply.send(ok({ url, writeEnabled }));
  });

  // POST /registry/config/test — test connectivity to the configured registry
  app.post('/registry/config/test', async (_request, reply) => {
    const url = process.env['SKILL_REGISTRY_URL'] ?? '';
    if (!url) return reply.send(ok({ connected: false, url: '', error: 'SKILL_REGISTRY_URL is not configured' }));
    try {
      const testClient = new SkillRegistryClient({ registryUrl: url });
      const skills = await testClient.list();
      return reply.send(ok({ connected: true, url, skillCount: skills.length }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.send(ok({ connected: false, url, error: msg }));
    }
  });
}
