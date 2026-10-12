import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { SshExecutorService } from '@bex/ssh-executor';

import { CreateTargetSchema, UpdateTargetSchema, ok, err, ErrorCodes } from '@bex/shared';

export async function targetRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  sshExecutor: SshExecutorService,
): Promise<void> {
  // GET /targets
  app.get('/targets', async (_request, reply) => {
    const targets = await prisma.target.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        hostname: true,
        sshPort: true,
        tags: true,
        apiBaseUrl: true,
        sshVerified: true,
        apiVerified: true,
        credentialId: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(ok(targets));
  });

  // GET /targets/:id
  app.get<{ Params: { id: string } }>('/targets/:id', async (request, reply) => {
    const target = await prisma.target.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Target not found'));
    return reply.send(ok(target));
  });

  // POST /targets
  app.post<{ Body: unknown }>('/targets', async (request, reply) => {
    const parsed = CreateTargetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const target = await prisma.target.create({ data: parsed.data as Prisma.TargetUncheckedCreateInput });
    return reply.status(201).send(ok(target));
  });

  // PUT /targets/:id
  app.put<{ Params: { id: string }; Body: unknown }>('/targets/:id', async (request, reply) => {
    const parsed = UpdateTargetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const existing = await prisma.target.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Target not found'));

    const target = await prisma.target.update({
      where: { id: request.params.id },
      data: parsed.data as Prisma.TargetUncheckedUpdateInput,
    });
    return reply.send(ok(target));
  });

  // DELETE /targets/:id
  app.delete<{ Params: { id: string } }>('/targets/:id', async (request, reply) => {
    const existing = await prisma.target.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Target not found'));
    await prisma.target.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });

  // POST /targets/:id/verify-ssh — Test SSH connectivity (tighter rate limit: SSH is expensive)
  app.post<{ Params: { id: string } }>('/targets/:id/verify-ssh', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const existing = await prisma.target.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Target not found'));

    const result = await sshExecutor.verify(request.params.id);
    return reply.send(ok(result));
  });

  // POST /targets/:id/exec — Execute a command on the target (requires write:ssh permission)
  app.post<{ Params: { id: string }; Body: unknown }>('/targets/:id/exec', {
    preHandler: [app.requireSystemUser],
  }, async (request, reply) => {
    const body = request.body as { command?: string };
    if (!body.command || typeof body.command !== 'string') {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, '"command" is required'));
    }

    const existing = await prisma.target.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Target not found'));

    const result = await sshExecutor.exec(request.params.id, body.command);
    return reply.send(ok(result));
  });
}
