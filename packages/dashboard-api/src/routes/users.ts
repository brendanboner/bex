import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { ok, err, ErrorCodes } from '@bclaw/shared';

export async function userRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // System users only
  app.get('/admin/users', { onRequest: [app.requireSystemUser] }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, externalId: true, displayName: true, email: true, isSystemUser: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(users));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/admin/users/:id',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      const body = request.body as { isSystemUser?: boolean; displayName?: string };
      const user = await prisma.user.update({
        where: { id: request.params.id },
        data: {
          ...(body.isSystemUser !== undefined ? { isSystemUser: body.isSystemUser } : {}),
          ...(body.displayName ? { displayName: body.displayName } : {}),
        },
        select: { id: true, displayName: true, isSystemUser: true },
      });
      return reply.send(ok(user));
    },
  );

  // Upsert user from external identity (used by integrations on first contact)
  app.post<{ Body: unknown }>('/admin/users/upsert', async (request, reply) => {
    const body = request.body as { externalId: string; displayName: string; email?: string };
    if (!body?.externalId || !body?.displayName) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'externalId and displayName are required'));
    }
    const user = await prisma.user.upsert({
      where: { externalId: body.externalId },
      update: { displayName: body.displayName, ...(body.email ? { email: body.email } : {}) },
      create: { externalId: body.externalId, displayName: body.displayName, email: body.email },
      select: { id: true, externalId: true, displayName: true, isSystemUser: true },
    });
    return reply.send(ok(user));
  });
}
