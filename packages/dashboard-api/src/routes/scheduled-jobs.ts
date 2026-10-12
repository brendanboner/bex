import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateScheduledJobSchema, ok, err, ErrorCodes } from '@bex/shared';

export async function scheduledJobRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/admin/scheduled-jobs', async (_request, reply) => {
    const jobs = await prisma.scheduledJob.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(jobs));
  });

  app.get<{ Params: { id: string } }>('/admin/scheduled-jobs/:id', async (request, reply) => {
    const job = await prisma.scheduledJob.findUnique({ where: { id: request.params.id } });
    if (!job) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Scheduled job not found'));
    return reply.send(ok(job));
  });

  app.post<{ Body: unknown }>('/admin/scheduled-jobs', async (request, reply) => {
    const parsed = CreateScheduledJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const job = await prisma.scheduledJob.create({ data: {
      name: parsed.data.name,
      agentId: parsed.data.agentId,
      cronExpr: parsed.data.cronExpr,
      input: parsed.data.input,
      enabled: parsed.data.enabled,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    } });
    return reply.status(201).send(ok(job));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/admin/scheduled-jobs/:id',
    async (request, reply) => {
      const parsed = CreateScheduledJobSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
      }
      const job = await prisma.scheduledJob.update({
        where: { id: request.params.id },
        data: Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)),
      });
      return reply.send(ok(job));
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/scheduled-jobs/:id', async (request, reply) => {
    await prisma.scheduledJob.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });

  // Toggle enabled state
  app.post<{ Params: { id: string } }>('/admin/scheduled-jobs/:id/toggle', async (request, reply) => {
    const job = await prisma.scheduledJob.findUnique({
      where: { id: request.params.id },
      select: { enabled: true },
    });
    if (!job) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Scheduled job not found'));
    const updated = await prisma.scheduledJob.update({
      where: { id: request.params.id },
      data: { enabled: !job.enabled },
    });
    return reply.send(ok(updated));
  });
}
