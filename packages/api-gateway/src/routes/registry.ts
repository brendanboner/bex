import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { SkillRegistryClient, computeSkillChecksum } from '@bclaw/skill-registry-client';
import { ok, err, ErrorCodes } from '@bclaw/shared';
import type { SkillManifest } from '@bclaw/shared';

export async function registryRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const client = new SkillRegistryClient();

  // GET /registry/skills — list skills (local registry + remote if configured)
  app.get('/registry/skills', async (request, reply) => {
    const query = (request.query as Record<string, string>)['domain'];

    // Always serve locally published skills (this instance acts as registry)
    const localEntries = await prisma.skillRegistryEntry.findMany({
      where: query ? { domain: { contains: query } } : {},
      select: { domain: true, version: true, name: true, description: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });

    // Optionally supplement with remote registry if configured
    let remoteSkills: unknown[] = [];
    if (client.isConfigured) {
      try {
        remoteSkills = await client.list(query);
      } catch {
        // Non-fatal: serve local skills even if remote is unavailable
        app.log.warn('Remote registry unavailable');
      }
    }

    return reply.send(ok([...localEntries, ...remoteSkills]));
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
          description: body.description,
          manifest: body as object,
          registryUrl: null,
        },
        update: {
          name: body.name,
          description: body.description,
          manifest: body as object,
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
            description: manifest.description,
            capabilities: manifest.capabilities,
            tools: manifest.tools as object[],
            systemPrompt: manifest.systemPrompt,
            status: 'PUBLISHED',
          },
          update: {
            name: manifest.name,
            description: manifest.description,
            tools: manifest.tools as object[],
            systemPrompt: manifest.systemPrompt,
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
            description: manifest.description,
            manifest: manifest as object,
            registryUrl: client['baseUrl'] as string,
          },
          update: {
            manifest: manifest as object,
          },
        });

        return reply.send(ok({ skillId: skill.id, domain: skill.domain, version: skill.version }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.status(502).send(err(ErrorCodes.INTERNAL, msg));
      }
    },
  );
}
