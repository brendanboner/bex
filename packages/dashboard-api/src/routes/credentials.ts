import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { ok, err, ErrorCodes } from '@bex/shared';

export async function credentialRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // GET /admin/credentials — list all credentials (no secrets, metadata only)
  app.get('/admin/credentials', async (_request, reply) => {
    const credentials = await prisma.credential.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        scope: true,
        credentialType: true,
        allowedAgentPermissions: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { agents: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(ok(credentials.map(c => ({
      ...c,
      agentCount: c._count.agents,
      _count: undefined,
    }))));
  });

  // PATCH /admin/agents/:id/status — toggle agent status ACTIVE ↔ INACTIVE
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/agents/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body ?? {};
      const valid = ['ACTIVE', 'INACTIVE', 'DRAFT'];
      if (!status || !valid.includes(status)) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, `status must be one of: ${valid.join(', ')}`));
      }
      const agent = await prisma.agent.update({
        where: { id },
        data: { status: status as 'ACTIVE' | 'INACTIVE' | 'DRAFT' },
        select: { id: true, name: true, status: true },
      });
      return reply.send(ok(agent));
    },
  );

  // PATCH /admin/agents/:id/credential — assign or clear an agent's credential
  app.patch<{ Params: { id: string }; Body: { credentialId: string | null } }>(
    '/admin/agents/:id/credential',
    async (request, reply) => {
      const { id } = request.params;
      const { credentialId } = request.body ?? {};

      // If setting a credential, verify it exists
      if (credentialId) {
        const cred = await prisma.credential.findUnique({ where: { id: credentialId }, select: { id: true } });
        if (!cred) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Credential not found'));
      }

      const agent = await prisma.agent.update({
        where: { id },
        data: { credentialId: credentialId ?? null },
        select: {
          id: true,
          name: true,
          credentialId: true,
          credential: { select: { id: true, name: true, credentialType: true } },
        },
      });

      return reply.send(ok(agent));
    },
  );

  // GET /admin/agents/:id/credential — get the credential assigned to an agent
  app.get<{ Params: { id: string } }>(
    '/admin/agents/:id/credential',
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          credentialId: true,
          credential: { select: { id: true, name: true, credentialType: true, description: true } },
        },
      });
      if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));
      return reply.send(ok(agent));
    },
  );

  // GET /admin/agents — list all agents with their assigned credential name
  app.get('/admin/agents', async (_request, reply) => {
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        llmProvider: true,
        llmModel: true,
        credentialId: true,
        credential: { select: { id: true, name: true, credentialType: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(ok(agents));
  });

  // DELETE /admin/agents/:id — delete an agent
  app.delete<{ Params: { id: string } }>(
    '/admin/agents/:id',
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));
      await prisma.agent.delete({ where: { id: request.params.id } });
      return reply.send(ok({ deleted: true }));
    },
  );

  // POST /admin/agents — create an agent
  app.post<{ Body: {
    name: string;
    description?: string;
    llmProvider?: string;
    llmModel?: string;
    credentialId?: string;
  } }>(
    '/admin/agents',
    async (request, reply) => {
      const body = request.body;
      if (!body?.name) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'name is required'));

      // Resolve system user for ownerId
      const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true } });
      if (!systemUser) return reply.status(500).send(err(ErrorCodes.INTERNAL, 'No system user found'));

      const agent = await prisma.agent.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          llmProvider: body.llmProvider ?? 'openai',
          llmModel: body.llmModel ?? 'gpt-4o',
          ownerId: systemUser.id,
          ...(body.credentialId ? { credentialId: body.credentialId } : {}),
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          llmProvider: true,
          llmModel: true,
          credentialId: true,
          credential: { select: { id: true, name: true, credentialType: true } },
          createdAt: true,
        },
      });
      return reply.status(201).send(ok(agent));
    },
  );
}
