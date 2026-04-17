import { PrismaClient } from '@prisma/client';

import { createAgentWorker } from './queue.js';
import { runCronLoop } from './cron.js';

const prisma = new PrismaClient();

// Start the BullMQ worker
const worker = createAgentWorker(prisma);

worker.on('completed', (job) => {
  console.info(`[scheduler] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[scheduler] Job ${job?.id} failed:`, err);
});

// Run the cron loop every minute
async function cronTick(): Promise<void> {
  try {
    await runCronLoop();
  } catch (err) {
    console.error('[scheduler] Cron loop error:', err);
  }
}

void cronTick();
setInterval(() => void cronTick(), 60_000);

console.info('[scheduler] Worker and cron loop started');
