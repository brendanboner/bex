import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { PrismaClient } from '@prisma/client';

import { endpointRoutes } from './routes/endpoints.js';
import { scheduledJobRoutes } from './routes/scheduled-jobs.js';
import { statusRoutes } from './routes/status.js';
import { userRoutes } from './routes/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireSystemUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function buildDashboardApi() {
  const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });
  const prisma = new PrismaClient();

  await app.register(helmet);
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3001',
    credentials: true,
  });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(sensible);
  await app.register(jwt, { secret: process.env['JWT_SECRET'] ?? 'change-me' });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
    }
  });

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

  app.get('/health', async () => ({ ok: true }));

  await statusRoutes(app, prisma);
  await endpointRoutes(app, prisma);
  await scheduledJobRoutes(app, prisma);
  await userRoutes(app, prisma);

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return app;
}

async function main() {
  const app = await buildDashboardApi();
  await app.listen({ port: Number(process.env['PORT'] ?? '4001'), host: '0.0.0.0' });
}

void main();
