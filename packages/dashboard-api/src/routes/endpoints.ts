import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { EndpointSchema, ok, err, ErrorCodes } from '@bex/shared';

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

  app.post<{ Body: unknown }>('/admin/endpoints', async (request, reply) => {
    const parsed = EndpointSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const { name, description, baseUrl, tags, aliases, notes, sshEnabled, hostname, sshPort, credentialId } = parsed.data;
    const endpoint = await prisma.endpoint.create({
      data: {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        tags,
        aliases,
        ...(notes !== undefined ? { notes } : {}),
        sshEnabled: sshEnabled ?? false,
        ...(hostname !== undefined ? { hostname } : {}),
        sshPort: sshPort ?? 22,
        ...(credentialId !== undefined ? { credentialId } : {}),
      },
    });
    return reply.status(201).send(ok(endpoint));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/admin/endpoints/:id',
    async (request, reply) => {
      const parsed = EndpointSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
      }

      // Fetch old baseUrl before update so we can propagate URL changes to skill tools
      const old = await prisma.endpoint.findUnique({ where: { id: request.params.id }, select: { baseUrl: true } });

      const endpoint = await prisma.endpoint.update({
        where: { id: request.params.id },
        data: Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)),
      });

      // If baseUrl changed, rewrite any skill tool configs that contain the old URL
      if (old?.baseUrl && parsed.data.baseUrl && old.baseUrl !== parsed.data.baseUrl) {
        const skills = await prisma.skill.findMany({ select: { id: true, tools: true } });
        for (const skill of skills) {
          const raw = JSON.stringify(skill.tools);
          if (raw.includes(old.baseUrl)) {
            const updated = raw.replaceAll(old.baseUrl, parsed.data.baseUrl);
            await prisma.skill.update({ where: { id: skill.id }, data: { tools: JSON.parse(updated) } });
          }
        }
      }

      return reply.send(ok(endpoint));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/endpoints/:id',
    async (request, reply) => {
      await prisma.endpoint.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    },
  );
}
