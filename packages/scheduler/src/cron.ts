import { PrismaClient } from '@prisma/client';
import cronParser from 'cron-parser';

import type { AgentJobData } from './queue.js';
import { createAgentQueue } from './queue.js';

const prisma = new PrismaClient();
const queue = createAgentQueue();

// System user ID used for scheduled job requests
const SYSTEM_USER_ID = process.env['SYSTEM_USER_ID'] ?? 'system';

/**
 * Cron scheduler loop — runs every minute and enqueues any jobs due for execution.
 */
export async function runCronLoop(): Promise<void> {
  const now = new Date();

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
        userId: SYSTEM_USER_ID,
        status: 'QUEUED',
        input: job.input,
        channel: 'api',
      },
      select: { id: true },
    });

    const jobData: AgentJobData = {
      requestId: request.id,
      agentId: job.agentId,
      userId: SYSTEM_USER_ID,
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
