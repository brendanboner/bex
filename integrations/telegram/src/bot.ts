import { Bot, Context, session } from 'grammy';
import type { SessionFlavor } from 'grammy';
import { fetch } from 'undici';

const BOT_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const API_GATEWAY_URL = requireEnv('API_GATEWAY_URL');
const DEFAULT_AGENT_ID = requireEnv('TELEGRAM_DEFAULT_AGENT_ID');
const BOT_API_KEY = requireEnv('BFORGE_BOT_API_KEY');

interface SessionData {
  pendingRequestId?: string;
}

type BotContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<BotContext>(BOT_TOKEN);

bot.use(session({ initial: (): SessionData => ({}) }));

// /start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    '👋 Welcome to Forge!\n\nSend me any message and I\'ll route it to your agent.\nUse /status to check a running request.',
  );
});

// /status command
bot.command('status', async (ctx) => {
  const requestId = ctx.session.pendingRequestId;
  if (!requestId) {
    await ctx.reply('No active request found.');
    return;
  }

  const res = await fetch(`${API_GATEWAY_URL}/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${BOT_API_KEY}` },
  });

  const data = (await res.json()) as { ok: boolean; data?: { status: string; output?: string } };
  if (data.ok && data.data) {
    const { status, output } = data.data;
    await ctx.reply(`Status: *${status}*\n${output ? `\n${output}` : ''}`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply('Could not fetch request status.');
  }
});

// Route all other messages to the api-gateway
bot.on('message:text', async (ctx) => {
  const input = ctx.message.text;
  const telegramUserId = String(ctx.from.id);

  await ctx.replyWithChatAction('typing');

  try {
    const res = await fetch(`${API_GATEWAY_URL}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOT_API_KEY}`,
        'X-Bclaw-User-External-Id': telegramUserId,
      },
      body: JSON.stringify({
        agentId: DEFAULT_AGENT_ID,
        input,
        channel: 'telegram',
      }),
    });

    const data = (await res.json()) as { ok: boolean; data?: { requestId: string } };

    if (!data.ok || !data.data) {
      await ctx.reply('❌ Failed to queue request. Please try again.');
      return;
    }

    const requestId = data.data.requestId;
    ctx.session.pendingRequestId = requestId;

    // Poll for completion and auto-reply with the result
    const POLL_INTERVAL_MS = 2_000;
    const MAX_WAIT_MS = 120_000;
    const started = Date.now();
    let typingInterval: ReturnType<typeof setInterval> | undefined;

    // Keep showing "typing..." while we wait
    typingInterval = setInterval(() => {
      void ctx.replyWithChatAction('typing');
    }, 4_000);

    try {
      while (Date.now() - started < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const statusRes = await fetch(`${API_GATEWAY_URL}/requests/${requestId}`, {
          headers: { Authorization: `Bearer ${BOT_API_KEY}` },
        });
        const statusData = (await statusRes.json()) as {
          ok: boolean;
          data?: { status: string; output?: string; errorMsg?: string };
        };

        if (!statusData.ok || !statusData.data) continue;
        const { status, output, errorMsg } = statusData.data;

        if (status === 'COMPLETED') {
          clearInterval(typingInterval);
          await ctx.reply(output ?? '(No response)', { parse_mode: 'Markdown' });
          return;
        }

        if (status === 'FAILED') {
          clearInterval(typingInterval);
          await ctx.reply(`❌ Request failed: ${errorMsg ?? 'Unknown error'}`);
          return;
        }

        if (status === 'AWAITING_APPROVAL') {
          clearInterval(typingInterval);
          await ctx.reply(
            `⏳ Action requires approval (ID: \`${requestId}\`).\nUse /approve or /deny to respond.`,
            { parse_mode: 'Markdown' },
          );
          return;
        }
      }

      // Timeout
      clearInterval(typingInterval);
      await ctx.reply(
        `⏳ Request is taking longer than expected (ID: \`${requestId}\`).\nUse /status to check when it completes.`,
        { parse_mode: 'Markdown' },
      );
    } catch (pollErr) {
      clearInterval(typingInterval);
      console.error('[telegram] Polling error:', pollErr);
      await ctx.reply(
        `✅ Request queued (ID: \`${requestId}\`). Use /status to check progress.`,
        { parse_mode: 'Markdown' },
      );
    }
  } catch (err) {
    console.error('[telegram] Error routing message:', err);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
});

bot.catch((err) => {
  console.error('[telegram] Bot error:', err);
});

void bot.start();
console.info('[telegram] Bot started');

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
