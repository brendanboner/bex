import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { OrchestratorService } from '@bclaw/orchestrator';
import { CreateAgentRequestSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { createAgentQueue } from '@bclaw/scheduler';
import { resolveUserId } from '../user-resolver.js';

export async function requestRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  const orchestrator = new OrchestratorService(prisma);
  const queue = createAgentQueue();

  // POST /requests — submit a new agent request
  app.post<{ Body: unknown }>('/requests', async (request, reply) => {
    const parsed = CreateAgentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    // Create request record
    const agentRequest = await prisma.agentRequest.create({
      data: {
        agentId: parsed.data.agentId,
        userId,
        status: 'QUEUED',
        input: parsed.data.input,
        channel: parsed.data.channel,
      },
      select: { id: true },
    });

    // Enqueue for async execution
    await queue.add(agentRequest.id, {
      requestId: agentRequest.id,
      agentId: parsed.data.agentId,
      userId,
      input: parsed.data.input,
      channel: parsed.data.channel,
    });

    return reply.status(202).send(ok({ requestId: agentRequest.id, status: 'QUEUED' }));
  });

  // GET /requests/:id — poll request status
  app.get<{ Params: { id: string } }>('/requests/:id', async (request, reply) => {
    const { id } = request.params;
    const agentRequest = await prisma.agentRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        input: true,
        output: true,
        errorMsg: true,
        channel: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!agentRequest) {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Request not found'));
    }

    return reply.send(ok(agentRequest));
  });

  // GET /requests — list requests for the current user
  app.get('/requests', async (request, reply) => {
    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));
    const requests = await prisma.agentRequest.findMany({
      where: { userId },
      select: {
        id: true, agentId: true, status: true, input: true, output: true,
        errorMsg: true, channel: true, createdAt: true, completedAt: true,
        agent: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send(ok(requests));
  });

  // POST /approvals/:requestId/approve
  app.post<{ Params: { requestId: string } }>('/approvals/:requestId/approve', async (request, reply) => {
    const { PermissionGatewayService } = await import('@bclaw/permission-gateway');
    const gateway = new PermissionGatewayService(prisma);
    await gateway.recordDecision(request.params.requestId, 'APPROVED');

    // Re-enqueue the original request so the orchestrator can resume execution
    const agentRequest = await prisma.agentRequest.findUnique({
      where: { id: request.params.requestId },
      select: { id: true, agentId: true, userId: true, input: true, channel: true },
    });
    if (agentRequest) {
      await prisma.agentRequest.update({
        where: { id: agentRequest.id },
        data: { status: 'QUEUED' },
      });
      await queue.add(`resume-${agentRequest.id}`, {
        requestId: agentRequest.id,
        agentId: agentRequest.agentId,
        userId: agentRequest.userId,
        input: agentRequest.input,
        channel: agentRequest.channel as 'api' | 'telegram' | 'teams' | 'dashboard' | 'whatsapp' | 'scheduler',
      });
    }

    return reply.send(ok({ status: 'APPROVED' }));
  });

  // POST /approvals/:requestId/deny
  app.post<{ Params: { requestId: string } }>('/approvals/:requestId/deny', async (request, reply) => {
    const { PermissionGatewayService } = await import('@bclaw/permission-gateway');
    const gateway = new PermissionGatewayService(prisma);
    await gateway.recordDecision(request.params.requestId, 'DENIED');

    await prisma.agentRequest.update({
      where: { id: request.params.requestId },
      data: { status: 'FAILED', errorMsg: 'Denied by approver', completedAt: new Date() },
    });

    return reply.send(ok({ status: 'DENIED' }));
  });

  // POST /requests/:id/escalate — spawn a remediation agent for a monitoring result
  app.post<{ Params: { id: string }; Body: unknown }>('/requests/:id/escalate', async (request, reply) => {
    const parent = await prisma.agentRequest.findUnique({ where: { id: request.params.id } });
    if (!parent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Parent request not found'));

    const body = request.body as {
      remediationAgentId?: string;
      input?: string;
      channel?: string;
    };

    const remediationAgentId = body.remediationAgentId ?? parent.agentId;
    const escalationInput = body.input ?? `[ESCALATION from ${request.params.id}] ${parent.output ?? parent.input}`;
    const channel = (body.channel ?? parent.channel) as 'api' | 'telegram' | 'teams' | 'dashboard' | 'whatsapp' | 'scheduler';

    const userId = (request.user as { sub: string }).sub;
    const resolvedUserId = await resolveUserId(prisma, userId);
    if (!resolvedUserId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const remediation = await prisma.agentRequest.create({
      data: {
        agentId: remediationAgentId,
        userId: resolvedUserId,
        status: 'QUEUED',
        input: escalationInput,
        channel,
      },
      select: { id: true },
    });

    await queue.add(remediation.id, {
      requestId: remediation.id,
      agentId: remediationAgentId,
      userId: resolvedUserId,
      input: escalationInput,
      channel,
    });

    return reply.status(202).send(ok({
      requestId: remediation.id,
      parentRequestId: request.params.id,
      status: 'QUEUED',
    }));
  });
}
