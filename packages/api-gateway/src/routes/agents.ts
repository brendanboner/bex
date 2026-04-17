import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateAgentSchema, UpdateAgentSchema, ok, err, ErrorCodes } from '@bclaw/shared';

export async function agentRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // GET /agents
  app.get('/agents', async (_request, reply) => {
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, description: true, status: true, llmProvider: true, llmModel: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(agents));
  });

  // GET /agents/:id
  app.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.params.id },
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
    const userId = (request.user as { sub: string }).sub;
    const { skillIds, ...data } = parsed.data;

    const agent = await prisma.agent.create({
      data: {
        ...data,
        persona: data.persona ?? {},
        llmConfig: data.llmConfig ?? {},
        ownerId: userId,
        agentSkills: skillIds.length > 0
          ? { create: skillIds.map((skillId) => ({ skillId })) }
          : undefined,
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
        ...data,
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

  // DELETE /agents/:id
  app.delete<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    await prisma.agent.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });
}
