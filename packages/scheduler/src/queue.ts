import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';

import { OrchestratorService } from '@bclaw/orchestrator';

export type AgentJobData = {
  requestId: string;
  agentId: string;
  userId: string;
  input: string;
  channel: 'api' | 'telegram' | 'teams' | 'dashboard' | 'scheduler' | 'whatsapp';
};

export const AGENT_QUEUE_NAME = 'agent-jobs';

function getRedis(): IORedis {
  return new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

export function createAgentQueue(): Queue<AgentJobData> {
  const connection = getRedis();
  return new Queue<AgentJobData>(AGENT_QUEUE_NAME, { connection });
}

export function createAgentWorker(prisma: PrismaClient): Worker<AgentJobData> {
  const connection = getRedis();
  const orchestrator = new OrchestratorService(prisma);

  return new Worker<AgentJobData>(
    AGENT_QUEUE_NAME,
    async (job: Job<AgentJobData>) => {
      const { requestId, agentId, userId, input, channel } = job.data;

      console.info(`[scheduler] Processing job ${job.id} — request ${requestId}`);

      await orchestrator.execute({
        requestId,
        agentId,
        userId,
        input,
        channel: channel === 'scheduler' ? 'api' : channel,
      });
    },
    {
      connection,
      concurrency: Number(process.env['SCHEDULER_CONCURRENCY'] ?? '5'),
    },
  );
}
