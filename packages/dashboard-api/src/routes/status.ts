import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { ok } from '@bclaw/shared';

export async function statusRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/admin/status', async (_request, reply) => {
    // DB counts
    const [agents, skills, credentials, requests, users, endpoints, jobs] = await Promise.all([
      prisma.agent.count(),
      prisma.skill.count(),
      prisma.credential.count(),
      prisma.agentRequest.count(),
      prisma.user.count(),
      prisma.endpoint.count(),
      prisma.scheduledJob.count({ where: { enabled: true } }),
    ]);

    // Queue stats
    let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0 };
    try {
      const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
      });
      const queue = new Queue('agent-jobs', { connection: redis });
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
      queueStats = {
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        completed: counts['completed'] ?? 0,
        failed: counts['failed'] ?? 0,
      };
      await redis.quit();
    } catch {
      // Redis may not be available in all envs
    }

    // Recent request statuses
    const recentRequests = await prisma.agentRequest.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const requestsByStatus = Object.fromEntries(
      recentRequests.map((r: { status: string; _count: { status: number } }) => [r.status, r._count.status]),
    );

    return reply.send(
      ok({
        counts: { agents, skills, credentials, requests, users, endpoints, scheduledJobs: jobs },
        queue: queueStats,
        requestsByStatus,
      }),
    );
  });

  app.get('/admin/requests/recent', async (_request, reply) => {
    const recent = await prisma.agentRequest.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        channel: true,
        input: true,
        output: true,
        errorMsg: true,
        createdAt: true,
        completedAt: true,
        agent: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true } },
      },
    });
    return reply.send(ok(recent));
  });
}
