import { PrismaClient } from '@prisma/client';
import { loadSystemSecrets } from '@bex/credential-vault';

import { createAgentWorker } from './queue.js';
import { runCronLoop } from './cron.js';

const prisma = new PrismaClient();

// On startup: reset any requests that were left in RUNNING state by a prior crash.
async function resetOrphanedRequests(): Promise<void> {
  try {
    const { count } = await prisma.agentRequest.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'QUEUED', startedAt: null },
    });
    if (count > 0) {
      console.info(`[scheduler] Reset ${count} orphaned RUNNING request(s) → QUEUED`);
    }
  } catch (err) {
    console.error('[scheduler] Failed to reset orphaned requests:', err);
  }
}

// Run the cron loop every minute
async function cronTick(): Promise<void> {
  try {
    await runCronLoop();
  } catch (err) {
    console.error('[scheduler] Cron loop error:', err);
  }
}

async function main(): Promise<void> {
  await loadSystemSecrets(prisma);

  // Validate that at least one LLM API key is configured
  const llmKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AZURE_OPENAI_API_KEY'];
  const hasLlmKey = llmKeys.some((k) => process.env[k]);
  if (!hasLlmKey) {
    throw new Error(
      `No LLM API key configured. Set one of: ${llmKeys.join(', ')} ` +
      `in .env or via credential vault. Run 'bex init' to set up LLM configuration.`,
    );
  }

  await resetOrphanedRequests();

  // Start the BullMQ worker
  const worker = createAgentWorker(prisma);

  worker.on('completed', (job) => {
    console.info(`[scheduler] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[scheduler] Job ${job?.id} failed:`, err);
  });

  worker.on('error', (err) => {
    console.error('[scheduler] Worker error:', err.message);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[scheduler] Job ${jobId} stalled — will be retried`);
  });

  void cronTick();
  setInterval(() => void cronTick(), 60_000);

  console.info('[scheduler] Worker and cron loop started');
}

void main();
