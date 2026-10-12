import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ok, err, ErrorCodes } from '@bex/shared';
import { CoordinatorAgent, SessionManager } from '@bex/coordinator';
import { createAgentQueue, type AgentJobData } from '@bex/scheduler';
import { resolveAgentAlias } from '../agent-alias.js';

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

  /** Quick-poll a request until it completes or times out (ms). */
  async function quickPoll(requestId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = await prisma.agentRequest.findUnique({
        where: { id: requestId },
        select: { status: true, output: true, errorMsg: true },
      });
      if (!record) return null;
      if (record.status === 'COMPLETED') return record.output ?? '';
      if (record.status === 'FAILED') return record.errorMsg ?? '(agent reported failure)';
      await new Promise((r) => setTimeout(r, 1_500));
    }
    return null; // timed out — caller should surface as PENDING
  }

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
    const { message, sessionId } = parsed.data;
    const channel = parsed.data.channel ?? 'api';

    // ── @bex prefix: strip it — always goes to coordinator ───────────────────
    let messageToProcess = /^@bex\s+/i.test(message)
      ? message.replace(/^@bex\s+/i, '').trim()
      : message;

    // ── @alias prefix: resolve and route directly to the named agent ──────────
    // e.g. "@xiq show connected clients" or "@rd what's the weather?"
    // @bex is excluded — it always goes to the coordinator above.
    const aliasMatch = messageToProcess === message  // only if @bex wasn't stripped
      ? message.match(/^@(\S+)\s+([\s\S]+)/i)
      : null;

    if (aliasMatch) {
      const alias = aliasMatch[1]!;
      const agentInput = aliasMatch[2]!.trim();
      const agentId = await resolveAgentAlias(alias, prisma);

      if (agentId) {
        try {
          const systemUser = await prisma.user.findFirst({
            where: { isSystemUser: true },
            select: { id: true },
          });
          const effectiveUserId = systemUser?.id ?? userId;

          const agentReq = await prisma.agentRequest.create({
            data: { agentId, userId: effectiveUserId, status: 'QUEUED', input: agentInput, channel },
            select: { id: true },
          });

          const jobData: AgentJobData = {
            requestId: agentReq.id,
            agentId,
            userId: effectiveUserId,
            input: agentInput,
            channel: channel as AgentJobData['channel'],
          };
          await queue.add(agentReq.id, jobData);

          const output = await quickPoll(agentReq.id, 30_000);
          if (output !== null) {
            return reply.send(ok({ sessionId: sessionId ?? agentReq.id, output }));
          }
          return reply.send(ok({
            sessionId: sessionId ?? agentReq.id,
            output: '⏳ On it — the result will appear shortly.',
            pendingRequestIds: [agentReq.id],
          }));
        } catch (e) {
          return reply.status(500).send(err(ErrorCodes.INTERNAL, (e as Error).message));
        }
      }
      // Unknown alias — fall through to coordinator so it can try to route
      messageToProcess = message;
    }

    try {
      const result = await coordinator.chat(
        sessionId ?? null,
        userId,
        messageToProcess,
        channel,
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

  // POST /coordinator/sessions/:id/append — inject an assistant turn into session history
  // Used by integrations (e.g. Telegram bot) to record agent sub-task outputs so the
  // coordinator has full context when the user sends a follow-up reply.
  app.post<{ Params: { id: string }; Body: unknown }>('/coordinator/sessions/:id/append', async (request, reply) => {
    const session = await sessionManager.get(request.params.id);
    if (session === null) {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Session not found'));
    }
    const body = request.body as { role?: string; content?: string; agentName?: string };
    const role = (body.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'content is required'));
    }
    const prefix = body.agentName ? `[${body.agentName}]: ` : '';
    await sessionManager.appendTurn(session.id, {
      role,
      content: prefix + content,
      timestamp: new Date().toISOString(),
    });
    return reply.send(ok({ appended: true }));
  });
}
