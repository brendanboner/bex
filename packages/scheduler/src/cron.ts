import { PrismaClient } from '@prisma/client';
import cronParser from 'cron-parser';

import type { AgentJobData } from './queue.js';
import { createAgentQueue } from './queue.js';

const prisma = new PrismaClient();
const queue = createAgentQueue();

// Cached real DB id of the system user (externalId = 'system')
let _systemUserId: string | null = null;

async function resolveSystemUserId(): Promise<string | null> {
  if (_systemUserId) return _systemUserId;
  const user = await prisma.user.findUnique({ where: { externalId: 'system' } });
  if (user) {
    _systemUserId = user.id;
    return _systemUserId;
  }
  return null;
}

/**
 * Cron scheduler loop — runs every minute and enqueues any jobs due for execution.
 */
export async function runCronLoop(): Promise<void> {
  const now = new Date();

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    // DB not yet seeded — skip quietly until system user exists
    console.warn('[cron] System user not found in DB — skipping tick (run `bex init` to initialise)');
    return;
  }

  const jobs = await prisma.scheduledJob.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
  });

  for (const job of jobs) {
    // Create an AgentRequest record first
    const request = await prisma.agentRequest.create({
      data: {
        agentId: job.agentId,
        userId: systemUserId,
        status: 'QUEUED',
        input: job.input,
        channel: 'api',
      },
      select: { id: true },
    });

    const jobData: AgentJobData = {
      requestId: request.id,
      agentId: job.agentId,
      userId: systemUserId,
      input: job.input,
      channel: 'scheduler',
    };

    await queue.add(`scheduled-${job.id}`, jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    // Calculate next run time
    const interval = cronParser.parseExpression(job.cronExpr, { currentDate: now });
    const nextRunAt = interval.next().toDate();

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { lastRunAt: now, nextRunAt },
    });

    console.info(`[cron] Enqueued job "${job.name}" — next run: ${nextRunAt.toISOString()}`);
  }
}
