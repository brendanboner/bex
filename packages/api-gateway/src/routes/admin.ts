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
        isSystemUser: false,
      },
    });

    await vault.create({
      name: 'forge.llm.primary',
      description: `${llmProvider} LLM configuration`,
      scope: 'SYSTEM',
      value: { provider: llmProvider, apiKey: llmApiKey, model: llmModel },
      allowedAgentPermissions: [],
    });

    if (channel !== 'dashboard' && Object.keys(channelConfig).length > 0) {
      await vault.create({
        name: `forge.channel.${channel}`,
        description: `${channel} channel config`,
        scope: 'SYSTEM',
        value: channelConfig,
        allowedAgentPermissions: [],
      });
    }

    await knowledge.write(
      'platform',
      'config',
      [
        `# Forge Platform Configuration`,
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
}
