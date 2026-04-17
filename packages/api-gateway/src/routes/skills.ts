import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateSkillSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { SkillRegistryService } from '@bclaw/skill-engine';

export async function skillRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const registry = new SkillRegistryService(prisma);

  // GET /skills
  app.get('/skills', async (_request, reply) => {
    const skills = await prisma.skill.findMany({
      select: { id: true, name: true, domain: true, version: true, status: true, capabilities: true, createdAt: true },
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

  // POST /skills/:id/publish — publish a draft skill (system users only)
  app.post<{ Params: { id: string } }>(
    '/skills/:id/publish',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      await registry.publish(request.params.id);
      return reply.send(ok({ published: true }));
    },
  );
}
