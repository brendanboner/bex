import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { OrchestratorService } from '@bclaw/orchestrator';
import { CreateAgentRequestSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { createAgentQueue } from '@bclaw/scheduler';

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

    const userId = (request.user as { sub: string }).sub;

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
    const userId = (request.user as { sub: string }).sub;
    const requests = await prisma.agentRequest.findMany({
      where: { userId },
      select: { id: true, agentId: true, status: true, input: true, channel: true, createdAt: true },
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
    return reply.send(ok({ status: 'APPROVED' }));
  });

  // POST /approvals/:requestId/deny
  app.post<{ Params: { requestId: string } }>('/approvals/:requestId/deny', async (request, reply) => {
    const { PermissionGatewayService } = await import('@bclaw/permission-gateway');
    const gateway = new PermissionGatewayService(prisma);
    await gateway.recordDecision(request.params.requestId, 'DENIED');
    return reply.send(ok({ status: 'DENIED' }));
  });
}
