import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ok, err, ErrorCodes } from '@bex/shared';

const CreateJobSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  agentId: z.string(),
  cronExpression: z.string().min(9).max(100), // e.g. "0 * * * *"
  input: z.string().min(1),
  enabled: z.boolean().default(true),
});

export async function scheduledJobRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // GET /scheduled-jobs
  app.get('/scheduled-jobs', async (_request, reply) => {
    const jobs = await prisma.scheduledJob.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, description: true, agentId: true, cronExpr: true, enabled: true, lastRunAt: true, nextRunAt: true, createdAt: true },
    });
    return reply.send(ok(jobs));
  });

  // GET /scheduled-jobs/:id
  app.get<{ Params: { id: string } }>('/scheduled-jobs/:id', async (request, reply) => {
    const job = await prisma.scheduledJob.findUnique({ where: { id: request.params.id } });
    if (!job) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Scheduled job not found'));
    return reply.send(ok(job));
  });

  // POST /scheduled-jobs
  app.post<{ Body: unknown }>('/scheduled-jobs', async (request, reply) => {
    const parsed = CreateJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId }, select: { id: true } });
    if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));

    const job = await prisma.scheduledJob.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        agentId: parsed.data.agentId,
        cronExpr: parsed.data.cronExpression,
        input: parsed.data.input,
        enabled: parsed.data.enabled,
      },
    });

    return reply.status(201).send(ok(job));
  });

  // PATCH /scheduled-jobs/:id
  app.patch<{ Params: { id: string }; Body: unknown }>('/scheduled-jobs/:id', async (request, reply) => {
    const body = request.body as { enabled?: boolean; cronExpression?: string; input?: string };
    const job = await prisma.scheduledJob.update({
      where: { id: request.params.id },
      data: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.cronExpression !== undefined ? { cronExpr: body.cronExpression } : {}),
        ...(body.input !== undefined ? { input: body.input } : {}),
      },
    });
    return reply.send(ok(job));
  });

  // DELETE /scheduled-jobs/:id
  app.delete<{ Params: { id: string } }>('/scheduled-jobs/:id', async (request, reply) => {
    await prisma.scheduledJob.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });

  // POST /scheduled-jobs/:id/run-now — trigger immediate execution
  app.post<{ Params: { id: string } }>('/scheduled-jobs/:id/run-now', async (request, reply) => {
    const job = await prisma.scheduledJob.findUnique({ where: { id: request.params.id } });
    if (!job) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Scheduled job not found'));

    // Find the system user to attribute this run to
    const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
    if (!systemUser) return reply.status(500).send(err(ErrorCodes.INTERNAL, 'No system user found'));

    const { createAgentQueue } = await import('@bex/scheduler');
    const queue = createAgentQueue();

    const agentRequest = await prisma.agentRequest.create({
      data: {
        agentId: job.agentId,
        userId: systemUser.id,
        status: 'QUEUED',
        input: job.input,
        channel: 'scheduler',
      },
      select: { id: true },
    });

    await queue.add(`manual-${agentRequest.id}`, {
      requestId: agentRequest.id,
      agentId: job.agentId,
      userId: systemUser.id,
      input: job.input,
      channel: 'scheduler',
    });

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { lastRunAt: new Date() },
    });

    return reply.status(202).send(ok({ requestId: agentRequest.id, status: 'QUEUED' }));
  });
}
