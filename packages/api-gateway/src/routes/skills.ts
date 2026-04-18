import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateSkillSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { SkillBuilderService, SkillRegistryService, SkillTestRunner } from '@bclaw/skill-engine';
import { SkillRegistryClient, computeSkillChecksum } from '@bclaw/skill-registry-client';
import type { BuildSkillSource } from '@bclaw/skill-engine';

export async function skillRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const registry = new SkillRegistryService(prisma);
  const builder = new SkillBuilderService(prisma);
  const testRunner = new SkillTestRunner(prisma);
  const remoteRegistry = new SkillRegistryClient();

  // GET /skills
  app.get('/skills', async (_request, reply) => {
    const skills = await prisma.skill.findMany({
      select: { id: true, name: true, domain: true, version: true, status: true, capabilities: true, requiredCredentialType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(skills));
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
  app.post<{ Params: { id: string } }>(
    '/skills/:id/publish',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
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

      // Push to standalone registry if configured
      if (remoteRegistry.isConfigured) {
        try {
          const tools = (skill.tools as unknown[]) ?? [];
          const checksum = computeSkillChecksum(tools, skill.systemPrompt ?? undefined);
          // Build manifest — cast to satisfy exactOptionalPropertyTypes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          } as import('@bclaw/shared').SkillManifest;

          const { url } = await remoteRegistry.publish(manifest);
          app.log.info({ skillId: request.params.id, domain: skill.domain, registryUrl: url }, 'Skill pushed to standalone registry');

          // Store the registry entry locally for lookup
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manifestJson = manifest as any;
          await prisma.skillRegistryEntry.upsert({
            where: { domain_version: { domain: skill.domain, version: skill.version } },
            create: { domain: skill.domain, version: skill.version, name: skill.name, description: skill.description, registryUrl: url, manifest: manifestJson },
            update: { name: skill.name, description: skill.description, registryUrl: url, manifest: manifestJson },
          });

          return reply.send(ok({ published: true, skillId: request.params.id, registryUrl: url }));
        } catch (e) {
          app.log.warn({ err: e }, 'Failed to push to standalone registry — skill marked PUBLISHED locally only');
        }
      }

      return reply.send(ok({ published: true, skillId: request.params.id }));
    },
  );
}
