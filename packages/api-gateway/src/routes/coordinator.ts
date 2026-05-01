import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ok, err, ErrorCodes } from '@bex/shared';
import { CoordinatorAgent, SessionManager } from '@bex/coordinator';
import { createAgentQueue, type AgentJobData } from '@bex/scheduler';

const ChatBodySchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  channel: z.string().optional(),
});

const PlanBodySchema = z.object({
  goal: z.string().min(1),
});

export async function coordinatorRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const queue = createAgentQueue();

  const coordinator = new CoordinatorAgent(prisma, {
    knowledgeDir: process.env['KNOWLEDGE_DIR'] ?? './knowledge',
    ...(process.env['LLM_PROVIDER'] !== undefined ? { llmProvider: process.env['LLM_PROVIDER'] } : {}),
    ...(process.env['LLM_MODEL'] !== undefined ? { llmModel: process.env['LLM_MODEL'] } : {}),
    enqueueRequest: async (data: { requestId: string; agentId: string; userId: string; input: string; channel: string }) => {
      const jobData: AgentJobData = {
        requestId: data.requestId,
        agentId: data.agentId,
        userId: data.userId,
        input: data.input,
        channel: data.channel as AgentJobData['channel'],
      };
      await queue.add(data.requestId, jobData);
    },
  });

  const sessionManager = new SessionManager(prisma);

  // POST /coordinator/chat
  app.post<{ Body: unknown }>('/coordinator/chat', async (request, reply) => {
    const parsed = ChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const userId = (request.user as { sub: string }).sub;
    const { message, sessionId, channel } = parsed.data;

    try {
      const result = await coordinator.chat(
        sessionId ?? null,
        userId,
        message,
        channel ?? 'api',
      );
      return reply.send(ok(result));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send(err(ErrorCodes.INTERNAL, message));
    }
  });

  // POST /coordinator/plan
  app.post<{ Body: unknown }>('/coordinator/plan', async (request, reply) => {
    const parsed = PlanBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const userId = (request.user as { sub: string }).sub;

    try {
      const plan = await coordinator.plan(userId, parsed.data.goal);
      return reply.send(ok(plan));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send(err(ErrorCodes.INTERNAL, message));
    }
  });

  // GET /coordinator/sessions
  app.get('/coordinator/sessions', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const sessions = await sessionManager.list(userId);
    return reply.send(ok(sessions));
  });

  // GET /coordinator/sessions/:id
  app.get<{ Params: { id: string } }>('/coordinator/sessions/:id', async (request, reply) => {
    const session = await sessionManager.get(request.params.id);
    if (session === null) {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Session not found'));
    }
    return reply.send(ok(session));
  });
}
