import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateSkillSchema, ok, err, ErrorCodes } from '@bex/shared';
import { SkillBuilderService, SkillRegistryService, SkillTestRunner, SkillProberService } from '@bex/skill-engine';
import { SkillRegistryClient, computeSkillChecksum } from '@bex/skill-registry-client';
import { KnowledgeStore } from '@bex/knowledge-store';
import { CredentialVaultService } from '@bex/credential-vault';
import type { BuildSkillSource } from '@bex/skill-engine';

export async function skillRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const registry = new SkillRegistryService(prisma);
  const builder = new SkillBuilderService(prisma);
  const testRunner = new SkillTestRunner(prisma);
  const prober = new SkillProberService(prisma);
  const remoteRegistry = new SkillRegistryClient();
  const vault = new CredentialVaultService(prisma);

  // GET /skills
  app.get('/skills', async (_request, reply) => {
    const skills = await prisma.skill.findMany({
      select: { id: true, name: true, domain: true, version: true, status: true, capabilities: true, requiredCredentialType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // Attach registry sync status to each skill
    const registryEntries = await prisma.skillRegistryEntry.findMany({
      select: { domain: true, version: true },
    });
    const registryMap = new Map<string, string>(); // domain → version
    for (const e of registryEntries) registryMap.set(e.domain, e.version);

    const enriched = skills.map(s => {
      const registryVersion = registryMap.get(s.domain);
      return {
        ...s,
        isSyncedToRegistry: registryVersion === s.version,
        registryVersion: registryVersion ?? null,
      };
    });

    return reply.send(ok(enriched));
  });

  // GET /skills/tools?domain=<prefix> — list all skill tools grouped by domain
  // domain param is optional prefix filter e.g. "extremecloudiq" or "xco"
  app.get<{ Querystring: { domain?: string } }>('/skills/tools', async (request, reply) => {
    const { domain } = request.query;
    const skills = await prisma.skill.findMany({
      ...(domain ? { where: { domain: { startsWith: domain } } } : {}),
      select: {
        id: true,
        name: true,
        domain: true,
        status: true,
        tools: true,
      },
      orderBy: { domain: 'asc' },
    });
    type ToolEntry = { name: string; description?: string };
    const result = skills.map((s) => {
      const toolList = (Array.isArray(s.tools) ? s.tools : []) as ToolEntry[];
      return {
        domain: s.domain,
        skillName: s.name,
        status: s.status,
        toolCount: toolList.length,
        tools: toolList.map((t) => ({ name: t.name, description: t.description ?? '' })),
      };
    });
    return reply.send(ok(result));
  });

  // GET /skills/:id
  app.get<{ Params: { id: string } }>('/skills/:id', async (request, reply) => {
    const skill = await prisma.skill.findUnique({
      where: { id: request.params.id },
      include: { knowledgeSources: { select: { id: true, type: true, label: true, url: true, parsedAt: true } } },
    });
    if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));
    return reply.send(ok(skill));
  });

  // DELETE /skills/:id — remove a skill; warns via linkedAgentCount so the UI can confirm
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/skills/:id', async (request, reply) => {
    const { id } = request.params;
    const force = request.query.force === 'true';
    const skill = await prisma.skill.findUnique({
      where: { id },
      select: { id: true, status: true, domain: true, version: true, _count: { select: { agentSkills: true } } },
    });
    if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));

    // If linked to agents, require force=true (caller confirmed)
    if (skill._count.agentSkills > 0 && !force) {
      return reply.status(409).send(ok({
        requiresConfirm: true,
        linkedAgentCount: skill._count.agentSkills,
        message: `This skill is linked to ${skill._count.agentSkills} agent(s). Delete anyway?`,
      }));
    }

    // Unlink from all agents before deleting
    if (skill._count.agentSkills > 0) {
      await prisma.agentSkill.deleteMany({ where: { skillId: id } });
    }
    await prisma.skillRegistryEntry.deleteMany({ where: { domain: skill.domain, version: skill.version } });
    await prisma.skill.delete({ where: { id } });
    return reply.send(ok({ deleted: true }));
  });

  // GET /skills/:id/credential — find the SYSTEM credential for this skill's required type
  app.get<{ Params: { id: string } }>('/skills/:id/credential', async (request, reply) => {
    const skill = await prisma.skill.findUnique({
      where: { id: request.params.id },
      select: { id: true, domain: true, name: true, requiredCredentialType: true },
    });
    if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));
    if (!skill.requiredCredentialType) return reply.send(ok(null));

    const keyword = skill.domain.split('.').flatMap((k: string) => k.split('-'))
      .find((k: string) => !['networking', 'monitoring', 'cloud', 'extreme', 'extremecloudiq', 'operations', 'monitor'].includes(k));

    const credential = await prisma.credential.findFirst({
      where: {
        scope: 'SYSTEM',
        credentialType: skill.requiredCredentialType as never,
        ...(keyword ? { name: { contains: keyword, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, name: true, credentialType: true, createdAt: true, updatedAt: true },
    });
    return reply.send(ok(credential));
  });

  // PUT /skills/:id/credential — upsert SYSTEM credential for this skill
  app.put<{ Params: { id: string }; Body: unknown }>('/skills/:id/credential', async (request, reply) => {
    const skill = await prisma.skill.findUnique({
      where: { id: request.params.id },
      select: { id: true, domain: true, name: true, requiredCredentialType: true },
    });
    if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));
    if (!skill.requiredCredentialType) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Skill does not require credentials'));
    }

    const body = request.body as Record<string, string>;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Request body is required'));
    }

    // Determine credential name from skill domain keyword
    const stopWords = new Set(['networking', 'monitoring', 'cloud', 'extreme', 'extremecloudiq', 'operations', 'monitor']);
    const keyword = skill.domain.split('.').flatMap((k: string) => k.split('-'))
      .find((k: string) => !stopWords.has(k)) ?? skill.domain.split('.')[0];
    const credName = `${keyword} — ${skill.name}`;

    // Check for existing matching credential
    const existing = await prisma.credential.findFirst({
      where: {
        scope: 'SYSTEM',
        credentialType: skill.requiredCredentialType as never,
        name: { contains: keyword ?? '', mode: 'insensitive' as const },
      },
    });

    const credType = skill.requiredCredentialType as 'API_TOKEN' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'OAUTH2_CLIENT' | 'USER_PREFERENCE';
    let result: { id: string; name: string; credentialType: string };

    if (existing) {
      // Update encrypted value in-place — all agents referencing this credential pick up the change automatically
      result = await vault.create(
        { name: credName, scope: 'SYSTEM', credentialType: credType, value: body, allowedAgentPermissions: [] },
      );
      // Delete old one after creating new (vault.create always inserts)
      await prisma.credential.delete({ where: { id: existing.id } });
    } else {
      result = await vault.create(
        { name: credName, scope: 'SYSTEM', credentialType: credType, value: body, allowedAgentPermissions: [] },
      );
    }

    return reply.send(ok(result));
  });

  // POST /skills — manually register a skill (system users only)
  app.post<{ Body: unknown }>('/skills', { onRequest: [app.requireSystemUser] }, async (request, reply) => {
    const parsed = CreateSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const skill = await registry.register(parsed.data);
    return reply.status(201).send(ok(skill));
  });

  // POST /skills/discover — trigger skill discovery from knowledge sources
  app.post<{ Body: unknown }>('/skills/discover', async (request, reply) => {
    const body = request.body as { intent?: string; domain?: string };
    if (!body?.intent) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'intent is required'));
    }
    const discoveryReq = body.domain
      ? { intent: body.intent, domain: body.domain }
      : { intent: body.intent };
    const skill = await registry.createFromDiscovery(discoveryReq);
    return reply.status(202).send(ok({ skillId: skill.id, status: 'DRAFT' }));
  });

  // POST /skills/build — build a comprehensive skill from typed knowledge sources
  app.post<{ Body: unknown }>('/skills/build', async (request, reply) => {
    const body = request.body as {
      domain?: string;
      intent?: string;
      sources?: Array<{ type?: string; url?: string; content?: string; label?: string }>;
    };

    if (!body?.domain || !body.intent || !Array.isArray(body.sources) || body.sources.length === 0) {
      return reply.status(400).send(
        err(ErrorCodes.VALIDATION_ERROR, 'domain, intent, and at least one source are required'),
      );
    }

    const validSourceTypes = new Set(['openapi_url', 'pdf_url', 'markdown_url', 'raw_markdown']);
    for (const s of body.sources) {
      if (!s.type || !validSourceTypes.has(s.type) || !s.label) {
        return reply.status(400).send(
          err(ErrorCodes.VALIDATION_ERROR, `Each source must have a valid type (${[...validSourceTypes].join(', ')}) and label`),
        );
      }
    }

    const result = await builder.build({
      domain: body.domain,
      intent: body.intent,
      sources: body.sources as BuildSkillSource[],
    });

    // Non-blocking probe: validate public tool endpoints and record chain notes
    prober.probe(result.skillId).catch((e: unknown) =>
      console.warn(`[prober] probe failed for ${result.skillId}:`, e),
    );

    return reply.status(201).send(ok(result));
  });

  // POST /skills/:id/test — run the test suite for a skill
  app.post<{ Params: { id: string } }>('/skills/:id/test', async (request, reply) => {
    const skill = await prisma.skill.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));

    const report = await testRunner.run(request.params.id);
    return reply.send(ok(report));
  });

  // POST /skills/:id/publish — publish a draft skill (system users only)
  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/skills/:id/publish',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      const force = request.query.force === 'true';
      const skill = await prisma.skill.findUnique({
        where: { id: request.params.id },
        select: { id: true, domain: true, version: true, status: true },
      });
      if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));

      // Check for an existing PUBLISHED skill with the same domain (different version)
      const existing = await prisma.skill.findFirst({
        where: { domain: skill.domain, status: 'PUBLISHED', id: { not: skill.id } },
        select: { id: true, version: true, _count: { select: { agentSkills: true } } },
        orderBy: { createdAt: 'desc' },
      });

      if (existing && !force) {
        // Return conflict info so UI can prompt user to confirm replacing
        return reply.status(409).send(ok({
          requiresConfirm: true,
          existingVersion: existing.version,
          existingId: existing.id,
          linkedAgentCount: existing._count.agentSkills,
          message: `A published version (v${existing.version}) of "${skill.domain}" already exists. Replace it?`,
        }));
      }

      if (existing && force) {
        // Deprecate the old version and re-link agents to the new skill
        await prisma.agentSkill.updateMany({
          where: { skillId: existing.id },
          data: { skillId: skill.id },
        });
        await prisma.skill.update({ where: { id: existing.id }, data: { status: 'DEPRECATED' } });
      }

      await registry.publish(request.params.id);
      return reply.send(ok({ published: true }));
    },
  );

  // POST /skills/:id/publish-to-registry — push skill manifest to the central standalone registry
  app.post<{ Params: { id: string } }>(
    '/skills/:id/publish-to-registry',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      const skill = await prisma.skill.findUnique({ where: { id: request.params.id } });
      if (!skill) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Skill not found'));

      // Mark local skill as PUBLISHED
      await prisma.skill.update({ where: { id: request.params.id }, data: { status: 'PUBLISHED' } });

      // Push to standalone registry if configured and write-enabled
      if (remoteRegistry.isWriteEnabled) {
        try {
          const tools = (skill.tools as unknown[]) ?? [];
          const checksum = computeSkillChecksum(tools, skill.systemPrompt ?? undefined);

          // Bundle matching knowledge docs with the manifest
          const store = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
          const rootDomain = skill.domain.split('.')[0] ?? skill.domain;
          const allTopics = await store.list().catch(() => [] as Awaited<ReturnType<typeof store.list>>);
          const matchingTopics = allTopics.filter((t) => t.domain === rootDomain || t.domain.startsWith(`${rootDomain}/`));
          const knowledgeDocs = (await Promise.all(
            matchingTopics.map(async (t) => {
              const entry = await store.read(t.domain, t.topic);
              return entry ? { domain: t.domain, topic: t.topic, content: entry.content } : null;
            }),
          )).filter((d): d is NonNullable<typeof d> => d !== null);

          // Bundle domain intelligence (entity graph + playbooks) — doc index intentionally omitted
          // as URLs are instance-specific and may go stale
          const domainKnowledgeRecord = await prisma.domainKnowledge.findUnique({ where: { domain: rootDomain } });
          const entityGraph = (domainKnowledgeRecord?.entityGraph as Record<string, unknown> | null) ?? {};
          const playbooks = (domainKnowledgeRecord?.playbooks as Array<Record<string, unknown>> | null) ?? [];
          const hasDomainKnowledge = Object.keys(entityGraph).length > 0 || playbooks.length > 0;

          const manifest = {
            domain: skill.domain,
            version: skill.version,
            name: skill.name,
            ...(skill.description && { description: skill.description }),
            ...(skill.systemPrompt && { systemPrompt: skill.systemPrompt }),
            tools,
            capabilities: skill.capabilities,
            checksum,
            publishedAt: new Date().toISOString(),
            ...(knowledgeDocs.length > 0 && { knowledgeDocs }),
            ...(hasDomainKnowledge && { domainKnowledge: { entityGraph, playbooks } }),
          } as import('@bex/shared').SkillManifest;

          const { url } = await remoteRegistry.publish(manifest);
          app.log.info({ skillId: request.params.id, domain: skill.domain, registryUrl: url, playbooksIncluded: playbooks.length }, 'Skill pushed to standalone registry');

          // Store the registry entry locally for lookup
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manifestJson = manifest as any;
          await prisma.skillRegistryEntry.upsert({
            where: { domain_version: { domain: skill.domain, version: skill.version } },
            create: { domain: skill.domain, version: skill.version, name: skill.name, description: skill.description, registryUrl: url, manifest: manifestJson },
            update: { name: skill.name, description: skill.description, registryUrl: url, manifest: manifestJson },
          });

          return reply.send(ok({ published: true, skillId: request.params.id, registryUrl: url, playbooksIncluded: playbooks.length }));
        } catch (e) {
          app.log.warn({ err: e }, 'Failed to push to standalone registry — skill marked PUBLISHED locally only');
        }
      }

      return reply.send(ok({ published: true, skillId: request.params.id }));
    },
  );

  // ── Domain Knowledge routes ───────────────────────────────────────────────
  // GET /domains — list all domains with knowledge records
  app.get('/domains', async (_request, reply) => {
    const records = await prisma.domainKnowledge.findMany({ orderBy: { domain: 'asc' } });
    return reply.send(ok(records));
  });

  // GET /domains/:domain/knowledge — get or auto-create for a domain
  app.get<{ Params: { domain: string } }>('/domains/:domain/knowledge', async (request, reply) => {
    const { domain } = request.params;
    const record = await prisma.domainKnowledge.upsert({
      where: { domain },
      create: { domain },
      update: {},
    });
    return reply.send(ok(record));
  });

  // PUT /domains/:domain/knowledge — upsert domain knowledge (full replace of any provided field)
  app.put<{ Params: { domain: string }; Body: unknown }>('/domains/:domain/knowledge', async (request, reply) => {
    const { domain } = request.params;
    const body = request.body as { docIndex?: unknown; entityGraph?: unknown; playbooks?: unknown };
    const record = await prisma.domainKnowledge.upsert({
      where: { domain },
      create: {
        domain,
        ...(body.docIndex !== undefined && { docIndex: body.docIndex as never }),
        ...(body.entityGraph !== undefined && { entityGraph: body.entityGraph as never }),
        ...(body.playbooks !== undefined && { playbooks: body.playbooks as never }),
      },
      update: {
        ...(body.docIndex !== undefined && { docIndex: body.docIndex as never }),
        ...(body.entityGraph !== undefined && { entityGraph: body.entityGraph as never }),
        ...(body.playbooks !== undefined && { playbooks: body.playbooks as never }),
      },
    });
    return reply.send(ok(record));
  });

  // PATCH /domains/:domain/knowledge/playbooks — merge-append playbooks (dedup by name)
  app.patch<{ Params: { domain: string }; Body: unknown }>('/domains/:domain/knowledge/playbooks', async (request, reply) => {
    const { domain } = request.params;
    const incoming = (request.body as { playbooks?: unknown[] }).playbooks ?? [];
    const record = await prisma.domainKnowledge.upsert({
      where: { domain },
      create: { domain, playbooks: incoming as never },
      update: {},
    });
    const existing = (record.playbooks as Array<{ name: string }>) ?? [];
    const merged = [...existing];
    for (const p of incoming as Array<{ name: string }>) {
      const idx = merged.findIndex((e) => e.name === p.name);
      if (idx >= 0) merged[idx] = p;
      else merged.push(p);
    }
    const updated = await prisma.domainKnowledge.update({
      where: { domain },
      data: { playbooks: merged as never },
    });
    return reply.send(ok(updated));
  });
}
