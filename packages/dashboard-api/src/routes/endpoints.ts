import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { EndpointSchema, ok, err, ErrorCodes } from '@bclaw/shared';

export async function endpointRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/admin/endpoints', async (_request, reply) => {
    const endpoints = await prisma.endpoint.findMany({ orderBy: { name: 'asc' } });
    return reply.send(ok(endpoints));
  });

  app.get<{ Params: { id: string } }>('/admin/endpoints/:id', async (request, reply) => {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: request.params.id } });
    if (!endpoint) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Endpoint not found'));
    return reply.send(ok(endpoint));
  });

  app.post<{ Body: unknown }>('/admin/endpoints', { onRequest: [app.requireSystemUser] }, async (request, reply) => {
    const parsed = EndpointSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const endpoint = await prisma.endpoint.create({ data: parsed.data });
    return reply.status(201).send(ok(endpoint));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/admin/endpoints/:id',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      const parsed = EndpointSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
      }
      const endpoint = await prisma.endpoint.update({
        where: { id: request.params.id },
        data: parsed.data,
      });
      return reply.send(ok(endpoint));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/endpoints/:id',
    { onRequest: [app.requireSystemUser] },
    async (request, reply) => {
      await prisma.endpoint.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    },
  );
}
