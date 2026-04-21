import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ok, err, ErrorCodes } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';

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

  // PATCH /llm-configs/:id — update (including setting as default and rotating API key)
  app.patch<{ Params: { id: string }; Body: Partial<LLMConfigBody> }>(
    '/llm-configs/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { name, provider, model, isDefault, apiKey, baseUrl } = request.body;

      const existing = await prisma.lLMConfig.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'LLM config not found'));

      if (isDefault) {
        await prisma.lLMConfig.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      }

      // Rotate the API key if a new one was provided
      let credentialId = existing.credentialId ?? undefined;
      if (apiKey) {
        if (credentialId) {
          // Delete old credential and create new one
          await vault.delete(credentialId).catch(() => {});
        }
        const cred = await vault.create({
          name: `llm-${(name ?? existing.name).toLowerCase().replace(/\s+/g, '-')}-key`,
          description: `API key for LLM config: ${name ?? existing.name}`,
          scope: 'SYSTEM',
          credentialType: 'API_TOKEN',
          allowedAgentPermissions: [],
          value: { apiKey },
        }, undefined);
        credentialId = cred.id;
      }

      const updated = await prisma.lLMConfig.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(provider && { provider }),
          ...(model && { model }),
          ...(isDefault !== undefined && { isDefault }),
          ...(baseUrl !== undefined && { baseUrl }),
          ...(credentialId && credentialId !== existing.credentialId && { credentialId }),
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

  // POST /llm-configs/:id/test — send a ping to verify the LLM config works
  app.post<{ Params: { id: string } }>('/llm-configs/:id/test', async (request, reply) => {
    const { id } = request.params;
    const config = await prisma.lLMConfig.findUnique({
      where: { id },
      include: { credential: { select: { id: true } } },
    });
    if (!config) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'LLM config not found'));

    let apiKey: string | undefined;
    if (config.credentialId) {
      const cred = await vault.resolve(config.credentialId, []);
      apiKey = (cred as { apiKey?: string }).apiKey;
    }

    try {
      let model;
      switch (config.provider) {
        case 'openai': {
          const key = apiKey ?? process.env['OPENAI_API_KEY'];
          if (!key) throw new Error('No API key configured');
          model = createOpenAI({ apiKey: key })(config.model);
          break;
        }
        case 'anthropic': {
          const key = apiKey ?? process.env['ANTHROPIC_API_KEY'];
          if (!key) throw new Error('No API key configured');
          model = createAnthropic({ apiKey: key })(config.model);
          break;
        }
        case 'azure-openai': {
          const key = apiKey ?? process.env['AZURE_OPENAI_API_KEY'];
          const resource = process.env['AZURE_OPENAI_RESOURCE_NAME'];
          if (!key || !resource) throw new Error('Azure credentials not configured');
          model = createAzure({ apiKey: key, resourceName: resource })(config.model);
          break;
        }
        case 'ollama': {
          const base = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
          model = createOpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama' })(config.model);
          break;
        }
        default:
          return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, `Unknown provider: ${config.provider}`));
      }

      const { text } = await generateText({ model, prompt: 'Say "OK" and nothing else.' });
      return reply.send(ok({ success: true, response: text.trim() }));
    } catch (e) {
      return reply.status(422).send(err(ErrorCodes.INTERNAL, `Connection failed: ${(e as Error).message}`));
    }
  });
}
