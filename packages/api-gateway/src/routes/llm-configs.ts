import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ok, err, ErrorCodes } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';

type LLMConfigBody = {
  name: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  isDefault?: boolean;
};

export async function llmConfigRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const vault = new CredentialVaultService(prisma);

  // GET /llm-configs — list all LLM configurations
  app.get('/llm-configs', async (_request, reply) => {
    const configs = await prisma.lLMConfig.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { credential: { select: { id: true, name: true } } },
    });
    return reply.send(ok(configs));
  });

  // POST /llm-configs — create a new LLM configuration
  app.post<{ Body: LLMConfigBody }>('/llm-configs', async (request, reply) => {
    const { name, provider, model, apiKey, baseUrl, isDefault } = request.body;
    if (!name || !provider || !model) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'name, provider, and model are required'));
    }
    if (provider === 'ollama' && !baseUrl) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'baseUrl is required for Ollama provider'));
    }

    let credentialId: string | undefined;

    // Store the API key as a credential if provided
    if (apiKey) {
      const cred = await vault.create(
        {
          name: `llm-${name.toLowerCase().replace(/\s+/g, '-')}`,
          description: `API key for LLM config: ${name}`,
          scope: 'SYSTEM',
          credentialType: 'API_TOKEN',
          allowedAgentPermissions: [],
          value: { apiKey },
        },
        undefined,
      );
      credentialId = cred.id;
    }

    // If this is set as default, clear existing defaults
    if (isDefault) {
      await prisma.lLMConfig.updateMany({ data: { isDefault: false } });
    }

    const config = await prisma.lLMConfig.create({
      data: {
        name, provider, model, isDefault: isDefault ?? false,
        ...(baseUrl ? { baseUrl } : {}),
        ...(credentialId ? { credentialId } : {}),
      },
    });

    return reply.status(201).send(ok(config));
  });

  // PATCH /llm-configs/:id — update (including setting as default)
  app.patch<{ Params: { id: string }; Body: Partial<LLMConfigBody> }>(
    '/llm-configs/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { name, provider, model, isDefault } = request.body;

      const existing = await prisma.lLMConfig.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'LLM config not found'));

      if (isDefault) {
        await prisma.lLMConfig.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      }

      const updated = await prisma.lLMConfig.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(provider && { provider }),
          ...(model && { model }),
          ...(isDefault !== undefined && { isDefault }),
        },
      });

      return reply.send(ok(updated));
    },
  );

  // DELETE /llm-configs/:id
  app.delete<{ Params: { id: string } }>('/llm-configs/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.lLMConfig.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'LLM config not found'));

    // Clean up credential if it was created for this config
    if (existing.credentialId) {
      await vault.delete(existing.credentialId).catch(() => {});
    }

    await prisma.lLMConfig.delete({ where: { id } });
    return reply.status(204).send();
  });
}
