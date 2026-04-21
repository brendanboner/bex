import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { PrismaClient } from '@prisma/client';

import { CredentialVaultService, loadSystemSecrets } from '@bclaw/credential-vault';
import { SshExecutorService } from '@bclaw/ssh-executor';

import { adminRoutes } from './routes/admin.js';
import { knowledgeRoutes } from './routes/knowledge.js';

import { agentRoutes } from './routes/agents.js';
import { constraintRoutes } from './routes/constraints.js';
import { credentialRoutes } from './routes/credentials.js';
import { requestRoutes } from './routes/requests.js';
import { skillRoutes } from './routes/skills.js';
import { targetRoutes } from './routes/targets.js';
import { registryRoutes } from './routes/registry.js';
import { coordinatorRoutes } from './routes/coordinator.js';
import { toolRoutes } from './routes/tools.js';
import { personaRoutes } from './routes/personas.js';
import { charterRoutes } from './routes/charter.js';
import { scheduledJobRoutes } from './routes/scheduled-jobs.js';
import { llmConfigRoutes } from './routes/llm-configs.js';
import { validateEnv } from './env.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireSystemUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function buildApp() {
  validateEnv();
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  const prisma = new PrismaClient();
  await loadSystemSecrets(prisma);
  const vault = new CredentialVaultService(prisma);
  const sshExecutor = new SshExecutorService(prisma, vault);

  // ─── Plugins ──────────────────────────────────────────────────────────────
  await app.register(helmet);
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  });
  await app.register(rateLimit, {
    max: Number(process.env['RATE_LIMIT_MAX'] ?? '100'),
    timeWindow: '1 minute',
  });
  await app.register(sensible);
  await app.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  });

  // ─── Auth hook ────────────────────────────────────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    // Public endpoints that bypass auth
    const publicPaths = ['/health', '/approvals', '/admin/setup', '/auth/login'];
    if (publicPaths.some((p) => request.url.startsWith(p))) return;
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    }
  });

  // ─── System user guard ────────────────────────────────────────────────────
  app.decorate(
    'requireSystemUser',
    async (request: Parameters<typeof app.requireSystemUser>[0], reply: Parameters<typeof app.requireSystemUser>[1]) => {
      const userId = (request.user as { sub: string }).sub;
      const user = await prisma.user.findUnique({
        where: { externalId: userId },
        select: { isSystemUser: true },
      });
      if (!user?.isSystemUser) {
        return reply.status(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'System users only' } });
      }
    },
  );

  // ─── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => ({ ok: true, version: process.env['npm_package_version'] ?? '0.1.0' }));

  // ─── Routes ───────────────────────────────────────────────────────────────
  await agentRoutes(app, prisma);
  await adminRoutes(app, prisma);
  await constraintRoutes(app, prisma);
  await credentialRoutes(app, prisma);
  await requestRoutes(app, prisma);
  await skillRoutes(app, prisma);
  await targetRoutes(app, prisma, sshExecutor);
  await registryRoutes(app, prisma);
  await coordinatorRoutes(app, prisma);
  await toolRoutes(app, prisma);
  await knowledgeRoutes(app);
  await personaRoutes(app, prisma);
  await charterRoutes(app, prisma);
  await scheduledJobRoutes(app, prisma);
  await llmConfigRoutes(app, prisma);

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return app;
}

// Start the server
async function main() {
  const app = await buildApp();
  await app.listen({
    port: Number(process.env['PORT'] ?? '4000'),
    host: '0.0.0.0',
  });
}

void main();
