import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { CredentialVaultService } from '@bclaw/credential-vault';
import { KnowledgeStore } from '@bclaw/knowledge-store';

const SetupSchema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  llmProvider: z.enum(['openai', 'anthropic', 'azure']),
  llmApiKey: z.string().min(10),
  llmModel: z.string().optional().default('gpt-4o'),
  channel: z.enum(['dashboard', 'telegram', 'teams', 'whatsapp']).optional().default('dashboard'),
  channelConfig: z.record(z.string()).optional().default({}),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function adminRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const vault = new CredentialVaultService(prisma);
  const knowledge = new KnowledgeStore(process.env['KNOWLEDGE_DIR'] ?? './knowledge');

  // GET /admin/setup/status — public
  app.get('/admin/setup/status', async () => {
    const configured = await prisma.user.findFirst({ where: { isSystemUser: false } });
    return { ok: true, data: { configured: !!configured } };
  });

  // POST /admin/setup — first-run bootstrap, public (but returns 409 if already done)
  app.post('/admin/setup', async (request, reply) => {
    const existingAdmin = await prisma.user.findFirst({ where: { isSystemUser: false } });
    if (existingAdmin) {
      return reply.status(409).send({
        ok: false,
        error: { code: 'CONFLICT', message: 'Platform already configured.' },
      });
    }

    const body = SetupSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: body.error.message },
      });
    }

    const { adminEmail, adminPassword, llmProvider, llmApiKey, llmModel, channel, channelConfig } = body.data;
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await prisma.user.upsert({
      where: { externalId: 'system' },
      update: {},
      create: { externalId: 'system', displayName: 'System', isSystemUser: true },
    });

    const admin = await prisma.user.create({
      data: {
        externalId: `admin-${Date.now()}`,
        email: adminEmail,
        displayName: adminEmail.split('@')[0] ?? 'Admin',
        passwordHash,
        isSystemUser: true, // bootstrapped admin has full system privileges
      },
    });

    await vault.create({
      name: 'bex.llm.primary',
      description: `${llmProvider} LLM configuration`,
      scope: 'SYSTEM',
      credentialType: 'API_TOKEN',
      value: { provider: llmProvider, apiKey: llmApiKey, model: llmModel },
      allowedAgentPermissions: [],
    });

    if (channel !== 'dashboard' && Object.keys(channelConfig).length > 0) {
      await vault.create({
        name: `bex.channel.${channel}`,
        description: `${channel} channel config`,
        scope: 'SYSTEM',
        credentialType: 'USER_PREFERENCE',
        value: channelConfig,
        allowedAgentPermissions: [],
      });
    }

    await knowledge.write(
      'platform',
      'config',
      [
        `# BEX Platform Configuration`,
        ``,
        `## LLM`,
        `- Provider: ${llmProvider}`,
        `- Model: ${llmModel}`,
        ``,
        `## Interface Channel`,
        `- Active: ${channel}`,
        ``,
        `## Admin`,
        `- Email: ${adminEmail}`,
        `- Configured: ${new Date().toISOString()}`,
      ].join('\n'),
    );

    const token = app.jwt.sign(
      { sub: admin.externalId, email: admin.email, role: 'admin' },
      { expiresIn: '7d' },
    );

    return reply.status(201).send({
      ok: true,
      data: {
        adminToken: token,
        dashboardUrl: `http://localhost:${process.env['DASHBOARD_PORT'] ?? '3000'}`,
        apiUrl: `http://localhost:${process.env['PORT'] ?? '4000'}`,
        message: 'Forge configured. Open the dashboard to get started.',
      },
    });
  });

  // POST /auth/login — email + password => JWT
  app.post('/auth/login', async (request, reply) => {
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: body.error.message },
      });
    }

    const user = await prisma.user.findUnique({ where: { email: body.data.email } });

    if (!user?.passwordHash) {
      return reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    const token = app.jwt.sign(
      { sub: user.externalId, email: user.email, role: user.isSystemUser ? 'system' : 'admin' },
      { expiresIn: '7d' },
    );

    return { ok: true, data: { token, expiresIn: '7d' } };
  });

  // POST /setup/llm — wizard step: configure initial LLM (authenticated)
  app.post<{ Body: { provider: string; apiKey?: string; baseUrl?: string; model?: string; name?: string } }>(
    '/setup/llm',
    async (request, reply) => {
      const { provider, apiKey, baseUrl, model = 'gpt-4o', name } = request.body;
      if (!provider) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'provider is required' } });
      if (provider === 'ollama' && !baseUrl) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'baseUrl is required for ollama' } });
      if (provider !== 'ollama' && !apiKey) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'apiKey is required for this provider' } });

      let credentialId: string | undefined;
      if (apiKey) {
        const cred = await vault.create({
          name: `llm-${provider}-setup`,
          description: `API key for ${provider}`,
          scope: 'SYSTEM',
          credentialType: 'API_TOKEN',
          allowedAgentPermissions: [],
          value: { apiKey },
        }, undefined);
        credentialId = cred.id;
      }

      // Upsert — clear existing defaults and create/update
      await prisma.lLMConfig.updateMany({ data: { isDefault: false } });
      const configName = name ?? `${provider} (default)`;
      const existing = await prisma.lLMConfig.findFirst({ where: { name: configName } });
      if (existing) {
        await prisma.lLMConfig.update({
          where: { id: existing.id },
          data: { provider, model, isDefault: true, ...(baseUrl ? { baseUrl } : {}), ...(credentialId ? { credentialId } : {}) },
        });
      } else {
        await prisma.lLMConfig.create({
          data: { name: configName, provider, model, isDefault: true, ...(baseUrl ? { baseUrl } : {}), ...(credentialId ? { credentialId } : {}) },
        });
      }

      return reply.send({ ok: true, data: { provider, model } });
    },
  );

  // POST /setup/notifications — wizard step: configure notification channel (authenticated)
  app.post<{ Body: { channel: string; [key: string]: unknown } }>(
    '/setup/notifications',
    async (request, reply) => {
      const { channel, ...channelConfig } = request.body;
      if (!channel) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'channel is required' } });

      if (channel !== 'dashboard') {
        await vault.create({
          name: `bex.channel.${channel}`,
          description: `${channel} channel config`,
          scope: 'SYSTEM',
          credentialType: 'API_TOKEN',
          allowedAgentPermissions: [],
          value: channelConfig as Record<string, string>,
        }, undefined);
      }

      return reply.send({ ok: true, data: { channel } });
    },
  );

  // POST /setup/notifications/test — send a test message
  app.post<{ Body: { channel: string; botToken?: string; chatId?: string; webhookUrl?: string } }>(
    '/setup/notifications/test',
    async (request, reply) => {
      const { channel, botToken, chatId, webhookUrl } = request.body;
      const { fetch } = await import('undici');

      try {
        if (channel === 'telegram') {
          if (!botToken || !chatId) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'botToken and chatId required' } });
          const res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '✅ BEX notification test — connection is working!' }) },
          );
          if (!res.ok) throw new Error(`Telegram API error: ${res.status}`);
        } else if (channel === 'teams') {
          if (!webhookUrl) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'webhookUrl required' } });
          const res = await fetch(webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: '✅ BEX notification test — connection is working!' }),
          });
          if (!res.ok) throw new Error(`Teams webhook error: ${res.status}`);
        } else {
          return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Test not supported for channel: ${channel}` } });
        }
        return reply.send({ ok: true, data: { sent: true } });
      } catch (e) {
        return reply.status(422).send({ ok: false, error: { code: 'INTERNAL', message: (e as Error).message } });
      }
    },
  );
}
