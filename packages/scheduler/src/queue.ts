import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { OrchestratorService } from '@bclaw/orchestrator';
import { KnowledgeStore } from '@bclaw/knowledge-store';

const CHAT_IDS_FILE = resolve(__dirname, '../../../data/telegram-chat-ids.json');
const knowledgeStore = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');

function loadKnownChatIds(): number[] {
  try {
    if (existsSync(CHAT_IDS_FILE)) {
      return JSON.parse(readFileSync(CHAT_IDS_FILE, 'utf8')) as number[];
    }
  } catch {}
  return [];
}

/** Send a message directly to one Telegram chat via Bot API (no bot process needed). */
async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const { fetch } = await import('undici');
  const TELEGRAM_MAX = 4096;

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf('\n', TELEGRAM_MAX);
    if (cut <= 0) cut = TELEGRAM_MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }

  for (const chunk of chunks) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
    } catch (err) {
      console.error(`[scheduler] Telegram send failed for chat ${chatId}:`, err);
    }
  }
}

/**
 * After a scheduled job completes:
 * 1. Append the result to the agent's memory doc (knowledge store) so future runs have context.
 * 2. Broadcast the result to all known Telegram chats.
 */
async function postJobActions(
  prisma: PrismaClient,
  requestId: string,
  agentId: string,
  jobName: string,
): Promise<void> {
  const request = await prisma.agentRequest.findUnique({
    where: { id: requestId },
    select: { status: true, output: true },
  });

  if (!request?.output || request.status !== 'COMPLETED') return;

  // ── Update agent memory (knowledge store) ────────────────────────────────
  try {
    const domain = `agent/${agentId}`;
    const existing = await knowledgeStore.read(domain, 'memory').catch(() => null);
    const timestamp = new Date().toISOString();
    const entry = `<!-- ${timestamp} — ${jobName} -->\n${request.output}`;
    const newContent = existing?.content
      ? `${existing.content}\n\n${entry}`
      : entry;

    // Keep memory from growing unbounded — keep last ~5000 chars
    const trimmed = newContent.length > 5000 ? newContent.slice(-5000) : newContent;
    await knowledgeStore.write(domain, 'memory', trimmed);
    console.info(`[scheduler] Updated memory for agent ${agentId}`);
  } catch (err) {
    console.error('[scheduler] Failed to update agent memory:', err);
  }

  // ── Telegram notification ─────────────────────────────────────────────────
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (!botToken) return;

  const chatIds = loadKnownChatIds();
  if (chatIds.length === 0) return;

  const header = `📅 Scheduled: ${jobName}\n\n`;

  console.info(`[scheduler] Notifying ${chatIds.length} Telegram chat(s) for job "${jobName}"`);
  for (const chatId of chatIds) {
    await sendTelegramMessage(botToken, chatId, header + request.output);
  }
}

export type AgentJobData = {
  requestId: string;
  agentId: string;
  userId: string;
  input: string;
  jobName?: string;
  channel: 'api' | 'telegram' | 'teams' | 'dashboard' | 'scheduler' | 'whatsapp';
};

export const AGENT_QUEUE_NAME = 'agent-jobs';

function getRedis(): IORedis {
  const client = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    // Required by BullMQ — prevents READY check racing during reconnect
    enableReadyCheck: false,
    // Retry forever with capped exponential backoff so the worker survives Redis restarts
    retryStrategy: (times: number) => Math.min(times * 100, 5_000),
  });

  client.on('error', (err) => {
    console.error('[scheduler] Redis connection error:', err.message);
  });
  client.on('reconnecting', () => {
    console.warn('[scheduler] Redis reconnecting...');
  });

  return client;
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
      const { requestId, agentId, userId, input, channel, jobName } = job.data;

      console.info(`[scheduler] Processing job ${job.id} — request ${requestId}`);

      await orchestrator.execute({
        requestId,
        agentId,
        userId,
        input,
        channel: channel === 'scheduler' ? 'api' : channel,
      });

      // For scheduled jobs, broadcast result to Telegram and update agent memory
      if (channel === 'scheduler') {
        await postJobActions(prisma, requestId, agentId, jobName ?? job.name);
      }
    },
    {
      connection,
      concurrency: Number(process.env['SCHEDULER_CONCURRENCY'] ?? '5'),
    },
  );
}
