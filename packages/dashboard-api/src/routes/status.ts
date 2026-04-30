import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { ok, getServiceVersions } from '@bex/shared';

export async function statusRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {

  // GET /admin/agents/live — agents with current active-request status for orbit view
  app.get('/admin/agents/live', async (_request, reply) => {
    const agents = await prisma.agent.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, status: true, description: true },
      orderBy: { name: 'asc' },
    });

    // Find which agent IDs have RUNNING or QUEUED requests right now
    const activeRequests = await prisma.agentRequest.findMany({
      where: { status: { in: ['RUNNING', 'QUEUED'] } },
      select: { agentId: true, status: true },
    });
    const activeAgentIds = new Set(activeRequests.map((r) => r.agentId));

    return reply.send(ok(
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        active: activeAgentIds.has(a.id),
      })),
    ));
  });

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

    // Get version information
    const versions = getServiceVersions();

    return reply.send(
      ok({
        counts: { agents, skills, credentials, requests, users, endpoints, scheduledJobs: jobs },
        queue: queueStats,
        requestsByStatus,
        versions: versions ? {
          global: versions.global.version,
          timestamp: versions.global.timestamp,
          services: Object.fromEntries(
            Object.entries(versions.services).map(([name, info]) => [name, { version: info.version, timestamp: info.timestamp }]),
          ),
        } : undefined,
      }),
    );
  });

  app.get('/admin/requests/recent', async (_request, reply) => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.agentRequest.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      where: { createdAt: { gte: oneHourAgo } },
      select: {
        id: true,
        status: true,
        channel: true,
        input: true,
        output: true,
        errorMsg: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        agent: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true } },
      },
    });
    return reply.send(ok(recent));
  });

  app.get<{ Params: { id: string } }>('/admin/requests/:id', async (request, reply) => {
    const { id } = request.params;
    const req = await prisma.agentRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        channel: true,
        input: true,
        output: true,
        errorMsg: true,
        turns: true,
        toolCalls: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        agent: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true } },
      },
    });
    if (!req) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Request not found' } });

    // Strip sensitive fields from tool call results (tokens, passwords, keys)
    const SENSITIVE = /token|password|secret|key|auth|bearer|credential/i;
    function sanitize(val: unknown): unknown {
      if (Array.isArray(val)) return val.map(sanitize);
      if (val && typeof val === 'object') {
        return Object.fromEntries(
          Object.entries(val as Record<string, unknown>).map(([k, v]) =>
            SENSITIVE.test(k) ? [k, '[redacted]'] : [k, sanitize(v)],
          ),
        );
      }
      return val;
    }

    return reply.send(ok({
      ...req,
      toolCalls: sanitize(req.toolCalls),
    }));
  });

  // DELETE /admin/requests — clear all request logs
  app.delete('/admin/requests', async (_request, reply) => {
    const { count } = await prisma.agentRequest.deleteMany({});
    return reply.send(ok({ deleted: count }));
  });

  // GET /admin/requests/grouped — requests aggregated by agent + input for activity log
  app.get('/admin/requests/grouped', async (_request, reply) => {
    const all = await prisma.agentRequest.findMany({
      take: 500,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        channel: true,
        input: true,
        errorMsg: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        agent: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true } },
      },
    });

    // Group by agentId + normalised input (first 120 chars)
    const groupMap = new Map<string, {
      key: string;
      agentId: string;
      agentName: string;
      inputSummary: string;
      channels: Set<string>;
      runs: typeof all;
    }>();

    for (const r of all) {
      const inputKey = (r.input ?? '').slice(0, 120).trim();
      const key = `${r.agent.id}::${inputKey}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          agentId: r.agent.id,
          agentName: r.agent.name,
          inputSummary: inputKey,
          channels: new Set(),
          runs: [],
        });
      }
      const g = groupMap.get(key)!;
      g.runs.push(r);
      if (r.channel) g.channels.add(r.channel);
    }

    const groups = Array.from(groupMap.values()).map((g) => {
      const sorted = g.runs; // already desc
      const counts = { COMPLETED: 0, FAILED: 0, RUNNING: 0, QUEUED: 0, OTHER: 0 };
      for (const r of sorted) {
        const s = r.status as keyof typeof counts;
        if (s in counts) counts[s]++;
        else counts.OTHER++;
      }
      if (!sorted.length) return null;
      const lastRun = sorted[0]!;
      return {
        key: g.key,
        agentId: g.agentId,
        agentName: g.agentName,
        inputSummary: g.inputSummary,
        channels: Array.from(g.channels),
        totalRuns: g.runs.length,
        counts,
        lastRunAt: lastRun.createdAt,
        lastStatus: lastRun.status,
        lastErrorMsg: lastRun.errorMsg ?? null,
        runs: sorted.slice(0, 20), // cap detail rows per group
      };
    }).filter(Boolean);

    return reply.send(ok(groups));
  });
}
