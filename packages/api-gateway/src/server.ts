import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { PrismaClient } from '@prisma/client';

import { agentRoutes } from './routes/agents.js';
import { credentialRoutes } from './routes/credentials.js';
import { requestRoutes } from './routes/requests.js';
import { skillRoutes } from './routes/skills.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireSystemUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  const prisma = new PrismaClient();

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
    const publicPaths = ['/health', '/approvals'];
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
  await credentialRoutes(app, prisma);
  await requestRoutes(app, prisma);
  await skillRoutes(app, prisma);

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
const app = await buildApp();
await app.listen({
  port: Number(process.env['PORT'] ?? '4000'),
  host: '0.0.0.0',
});
