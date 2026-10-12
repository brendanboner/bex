import type { FastifyInstance } from 'fastify';
import { PrismaClient, Prisma } from '@prisma/client';
import { KnowledgeStore } from '@bex/knowledge-store';

import { CreateAgentSchema, UpdateAgentSchema, ok, err, ErrorCodes } from '@bex/shared';

const WORKSPACE_TOPICS = ['instructions', 'context', 'memory'] as const;
type WorkspaceTopic = typeof WORKSPACE_TOPICS[number];

function getKnowledgeStore(): KnowledgeStore {
  return new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
}

function agentDomain(agentId: string): string {
  return `agent/${agentId}`;
}

export async function agentRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // GET /agents
  app.get('/agents', async (_request, reply) => {
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, description: true, status: true, isDefault: true, llmProvider: true, llmModel: true, createdAt: true, charter: { select: { posture: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return reply.send(ok(agents));
  });

  // GET /agents/:id
  app.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    // 'default' is a special alias for the system default agent
    const where = request.params.id === 'default'
      ? { isDefault: true }
      : { id: request.params.id };
    const agent = await prisma.agent.findFirst({
      where,
      include: { agentSkills: { include: { skill: { select: { id: true, name: true, domain: true, version: true } } } } },
    });
    if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));
    return reply.send(ok(agent));
  });

  // POST /agents
  app.post<{ Body: unknown }>('/agents', async (request, reply) => {
    const parsed = CreateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const externalId = (request.user as { sub: string }).sub;
    const { skillIds, status: agentStatus, ...data } = parsed.data;

    // Resolve DB user id from JWT sub (externalId)
    const user = await prisma.user.findUnique({ where: { externalId }, select: { id: true } });
    if (!user) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const agent = await prisma.agent.create({
      data: {
        ...data,
        description: data.description ?? null,
        ...(agentStatus !== undefined ? { status: agentStatus } : {}),
        persona: (data.persona ?? {}) as Prisma.InputJsonValue,
        llmConfig: (data.llmConfig ?? {}) as Prisma.InputJsonValue,
        ownerId: user.id,
        ...(skillIds.length > 0
          ? { agentSkills: { create: skillIds.map((skillId) => ({ skillId })) } }
          : {}),
      },
      select: { id: true, name: true, status: true },
    });

    return reply.status(201).send(ok(agent));
  });

  // PATCH /agents/:id
  app.patch<{ Params: { id: string }; Body: unknown }>('/agents/:id', async (request, reply) => {
    const parsed = UpdateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const { skillIds, ...data } = parsed.data;
    const agent = await prisma.agent.update({
      where: { id: request.params.id },
      data: {
        ...(data as Prisma.AgentUncheckedUpdateInput),
        ...(skillIds !== undefined
          ? {
              agentSkills: {
                deleteMany: {},
                create: skillIds.map((skillId) => ({ skillId })),
              },
            }
          : {}),
      },
      select: { id: true, name: true, status: true },
    });

    return reply.send(ok(agent));
  });

  // POST /agents/:id/skills — attach a skill to an agent
  app.post<{ Params: { id: string }; Body: unknown }>('/agents/:id/skills', async (request, reply) => {
    const body = request.body as { skillId?: string };
    if (!body.skillId) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'skillId required'));
    await prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId: request.params.id, skillId: body.skillId } },
      create: { agentId: request.params.id, skillId: body.skillId },
      update: {},
    });
    return reply.status(201).send(ok({ agentId: request.params.id, skillId: body.skillId }));
  });

  // DELETE /agents/:id/skills/:skillId — detach a skill from an agent
  app.delete<{ Params: { id: string; skillId: string } }>('/agents/:id/skills/:skillId', async (request, reply) => {
    await prisma.agentSkill.deleteMany({
      where: { agentId: request.params.id, skillId: request.params.skillId },
    });
    return reply.status(204).send();
  });

  // DELETE /agents/:id
  app.delete<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const agent = await prisma.agent.findUnique({ where: { id: request.params.id }, select: { isDefault: true } });
    if (agent?.isDefault) return reply.status(409).send(err(ErrorCodes.VALIDATION_ERROR, 'Cannot delete the default agent'));
    await prisma.agent.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });

  // POST /agents/:id/set-default — make this agent the system default (un-defaults any other)
  app.post<{ Params: { id: string } }>('/agents/:id/set-default', async (request, reply) => {
    await prisma.$transaction([
      prisma.agent.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.agent.update({ where: { id: request.params.id }, data: { isDefault: true } }),
    ]);
    return reply.send(ok({ defaultAgentId: request.params.id }));
  });

  // ─── Workspace Docs (OpenClaw-style soul/memory documents) ─────────────────

  // GET /agents/:id/workspace — list all workspace topics for an agent
  app.get<{ Params: { id: string } }>('/agents/:id/workspace', async (request, reply) => {
    const store = getKnowledgeStore();
    const topics = await store.list(agentDomain(request.params.id));
    return reply.send(ok(topics));
  });

  // GET /agents/:id/workspace/:topic — get a workspace doc
  app.get<{ Params: { id: string; topic: string } }>(
    '/agents/:id/workspace/:topic',
    async (request, reply) => {
      const { id, topic } = request.params;
      const store = getKnowledgeStore();
      const entry = await store.read(agentDomain(id), topic);
      if (!entry) {
        // Return empty doc for standard topics so the UI can render an editor
        if ((WORKSPACE_TOPICS as readonly string[]).includes(topic)) {
          return reply.send(ok({ domain: agentDomain(id), topic, content: '', updatedAt: new Date() }));
        }
        return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Workspace doc not found'));
      }
      return reply.send(ok(entry));
    },
  );

  // PUT /agents/:id/workspace/:topic — create or update a workspace doc
  app.put<{ Params: { id: string; topic: string }; Body: unknown }>(
    '/agents/:id/workspace/:topic',
    async (request, reply) => {
      const { id, topic } = request.params;
      const body = request.body as { content?: string };
      if (typeof body?.content !== 'string') {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'body.content is required'));
      }
      const store = getKnowledgeStore();
      const entry = await store.write(agentDomain(id), topic, body.content);
      return reply.send(ok(entry));
    },
  );

  // DELETE /agents/:id/workspace/:topic — delete a workspace doc
  app.delete<{ Params: { id: string; topic: string } }>(
    '/agents/:id/workspace/:topic',
    async (request, reply) => {
      const { id, topic } = request.params;
      const store = getKnowledgeStore();
      await store.delete(agentDomain(id), topic);
      return reply.status(204).send();
    },
  );
}
