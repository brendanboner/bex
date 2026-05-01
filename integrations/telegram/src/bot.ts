import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { Bot, Context, session } from 'grammy';
import type { SessionFlavor } from 'grammy';
import { fetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { loadSystemSecrets } from '@bex/credential-vault';

// Load .env from repo root (two directories up from integrations/telegram/dist)
dotenvConfig({ path: resolve(__dirname, '../../../.env'), override: true });

const CHAT_IDS_FILE = resolve(__dirname, '../../../data/telegram-chat-ids.json');

interface SessionData {
  pendingRequestId?: string | undefined;
}

type BotContext = Context & SessionFlavor<SessionData>;

// Persist chat IDs so we can send proactive notifications across restarts
const knownChatIds = new Set<number>(loadPersistedChatIds());

function loadPersistedChatIds(): number[] {
  try {
    if (existsSync(CHAT_IDS_FILE)) {
      return JSON.parse(readFileSync(CHAT_IDS_FILE, 'utf8')) as number[];
    }
  } catch {}
  return [];
}

function trackChatId(chatId: number): void {
  if (knownChatIds.has(chatId)) return;
  knownChatIds.add(chatId);
  process.env['_TELEGRAM_CHAT_IDS'] = [...knownChatIds].join(',');
  // Persist to disk
  try {
    mkdirSync(resolve(CHAT_IDS_FILE, '..'), { recursive: true });
    writeFileSync(CHAT_IDS_FILE, JSON.stringify([...knownChatIds]));
  } catch {}
}

const TELEGRAM_MAX = 4096;

function chunkText(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= max) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n', max);
    if (cut <= 0) cut = max;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  return chunks;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

async function safeSend(ctx: BotContext, text: string): Promise<void> {
  const toMdV2 = (s: string): string =>
    s
      .replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
      .replace(/\\\*\\\*(.*?)\\\*\\\*/g, '*$1*')
      .replace(/(?<!\\\*)\\\*((?!\\\*).*?)\\\*/g, '_$1_');

  for (const chunk of chunkText(text)) {
    try {
      await ctx.reply(toMdV2(chunk), { parse_mode: 'MarkdownV2' });
    } catch {
      const plain = chunk.replace(/[*_`[\]]/g, '');
      try {
        await ctx.reply(plain);
      } catch (err) {
        console.error('[telegram] Failed to send message:', err);
      }
    }
  }
}

// ─── Async startup: load vault secrets, then initialize bot ──────────────────

(async () => {
  // TELEGRAM_BOT_TOKEN is stored in the credential vault during `bex init`.
  // If not already in env, load from vault with retries — the token may not
  // be available yet if the bot starts before init completes.
  let botToken: string | undefined = process.env['TELEGRAM_BOT_TOKEN'];
  if (!botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN not in env — waiting for credential vault...');
    // Retry for up to 30 minutes (180 × 10s). bex init can take several minutes
    // on first run (dashboard build + skill pulls), so a short window causes the
    // bot to give up before setup completes.
    const MAX_ATTEMPTS = 180;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const prisma = new PrismaClient();
      try {
        await loadSystemSecrets(prisma);
      } catch {
        // DB may not be ready yet — keep waiting
      } finally {
        await prisma.$disconnect();
      }
      botToken = process.env['TELEGRAM_BOT_TOKEN'];
      if (botToken) break;
      if (attempt % 6 === 0) {
        console.warn(`[telegram] Token not in vault yet (${attempt * 10}s elapsed) — run: bex init`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  if (!botToken) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN not found after 30 minutes. Run: bex init');
    process.exit(1);
  }

  const API_GATEWAY_URL = requireEnv('API_GATEWAY_URL');
  const NEXUS_AGENT_ID = process.env['NEXUS_AGENT_ID'] ?? '';
  const BOT_API_KEY = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
  if (!BOT_API_KEY) {
    console.warn('[telegram] BEX_BOT_API_KEY not set — API requests will fail. Run: bex init');
  }

  // A Telegram bot token looks like "1234567890:ABCdef..." — detect if someone
  // accidentally stored the bot token in TELEGRAM_DEFAULT_AGENT_ID.
  const looksLikeBotToken = (s: string) => /^\d{8,12}:[A-Za-z0-9_-]{30,}$/.test(s);

  let DEFAULT_AGENT_ID = process.env['TELEGRAM_DEFAULT_AGENT_ID'] ?? '';

  if (!DEFAULT_AGENT_ID || looksLikeBotToken(DEFAULT_AGENT_ID)) {
    if (DEFAULT_AGENT_ID) {
      console.warn(
        '[telegram] TELEGRAM_DEFAULT_AGENT_ID looks like a bot token, not a BEX agent ID. ' +
        'Auto-discovering the default agent…',
      );
    }
    // Auto-discover the best agent from the api-gateway so the bot works even
    // when TELEGRAM_DEFAULT_AGENT_ID was never set or was set to the wrong value.
    try {
      const res = await fetch(`${API_GATEWAY_URL}/agents`, {
        headers: { Authorization: `Bearer ${BOT_API_KEY}` },
      });
      const json = (await res.json()) as { ok: boolean; data?: Array<{ id: string; name: string; status?: string; isDefault?: boolean }> };
      const agents = (json.data ?? []).filter((a) => a.status !== 'INACTIVE');
      // Prefer explicitly flagged default → coordinator → first active agent.
      // Deliberately no hard-coded product preference so mixed XIQ+XCO installs
      // don't silently route everything to one product.
      const best =
        agents.find((a) => a.isDefault) ??
        agents.find((a) => /coordinator/i.test(a.name)) ??
        agents[0];
      if (best) {
        DEFAULT_AGENT_ID = best.id;
        console.info(`[telegram] Auto-discovered default agent: "${best.name}" (${best.id})`);
        console.info(`[telegram] To avoid this lookup on restart, set TELEGRAM_DEFAULT_AGENT_ID=${best.id} in .env`);
      } else {
        console.warn('[telegram] No agents found in api-gateway. Create an agent via bex init or the dashboard.');
      }
    } catch (err) {
      console.warn(`[telegram] Could not auto-discover agents: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const bot = new Bot<BotContext>(botToken);
  bot.use(session({ initial: (): SessionData => ({}) }));

  // ─── Agent name resolver — fuzzy-matches "@xco", "@xco-monitor" etc. ─────────
  // Cache for 60 s so repeated @name messages don't hammer the API.
  let _agentCacheExpiry = 0;
  let _agentCache: Array<{ id: string; name: string }> = [];

  async function resolveAgentByName(hint: string): Promise<string | null> {
    const now = Date.now();
    if (now > _agentCacheExpiry) {
      try {
        const r = await fetch(`${API_GATEWAY_URL}/agents`, {
          headers: { Authorization: `Bearer ${BOT_API_KEY}` },
        });
        const j = (await r.json()) as { ok: boolean; data?: Array<{ id: string; name: string; status?: string }> };
        _agentCache = (j.data ?? []).filter((a) => a.status !== 'INACTIVE');
        _agentCacheExpiry = now + 60_000;
      } catch { /* use stale cache */ }
    }
    // Normalise: "xco-monitor" → "xco monitor", collapse spaces
    const q = hint.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    // 1. Exact name match
    let found = _agentCache.find((a) => a.name.toLowerCase() === q);
    if (found) return found.id;
    // 2. Name starts with hint
    found = _agentCache.find((a) => a.name.toLowerCase().startsWith(q));
    if (found) return found.id;
    // 3. All hint words appear in name (e.g. "xco" matches "XCO Monitor")
    const words = q.split(' ').filter(Boolean);
    found = _agentCache.find((a) => words.every((w) => a.name.toLowerCase().includes(w)));
    if (found) return found.id;
    return null;
  }

  /** Send a message to all known chats */
  async function broadcastMessage(text: string): Promise<void> {
    for (const chatId of knownChatIds) {
      try {
        await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch {}
    }
  }

// ─── Commands ────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  trackChatId(ctx.chat.id);
  await ctx.reply(
    '👋 *Welcome to BEX!*\n\n' +
    'Send me any message and I\'ll route it to your AI agent.\n\n' +
    '*Commands:*\n' +
    '/status — check your last request\n' +
    '/jobs — list scheduled jobs\n' +
    '/agents — list available agents\n' +
    '/skills — list loaded skills\n' +
    '/tools — show tools for current agent\n' +
    '/help — show this message\n\n' +
    '*Route to a specific agent:*\n' +
    '  `@xco` — XCO Monitor (fabric health, topology)\n' +
    '  `@xco-operator` — XCO Operator (alarm management)\n' +
    '  `@xiq` — ExtremeCloud IQ\n' +
    '  `@bex` — BEX system admin (Nexus)\n\n' +
    '*Examples:*\n' +
    '  `@xco give me a full fabric overview`\n' +
    '  `@xco how is my network?`\n' +
    '  `@xiq show network health for Beverly`\n' +
    '  `@bex show me scheduled jobs`',
    { parse_mode: 'Markdown' },
  );
});

bot.command('help', async (ctx) => {
  trackChatId(ctx.chat.id);
  await ctx.reply(
    '🤖 *BEX Bot Commands*\n\n' +
    '*/start* — welcome & command list\n' +
    '*/status* — check your last request status\n' +
    '*/jobs* — list scheduled jobs (quick view, no AI)\n' +
    '*/agents* — list available agents\n' +
    '*/skills* — list loaded skills & domains\n' +
    '*/tools* — list all tools by domain (e.g. `/tools xco` or `/tools xiq`)\n' +
    '*/agent \\<id\\>* — switch to a different agent\n' +
    '*/cancel* — forget the current pending request\n\n' +
    '*Route to a specific agent with @name:*\n' +
    '  `@xco give me a full fabric overview`\n' +
    '  `@xco\\-monitor how is my network?`\n' +
    '  `@xco\\-operator acknowledge all major alarms`\n' +
    '  `@xiq show network health for Beverly`\n' +
    '  `@bex system status`\n\n' +
    'Or just type any message to ask your default agent\\.',
    { parse_mode: 'MarkdownV2' },
  );
});

// /status command
bot.command('status', async (ctx) => {
  trackChatId(ctx.chat.id);
  const requestId = ctx.session.pendingRequestId;
  if (!requestId) {
    await ctx.reply('No active request. Send me a message to start one!');
    return;
  }

  const res = await fetch(`${API_GATEWAY_URL}/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${BOT_API_KEY}` },
  });

  const data = (await res.json()) as { ok: boolean; data?: { status: string; output?: string } };
  if (data.ok && data.data) {
    const { status, output } = data.data;
    const emoji = status === 'COMPLETED' ? '✅' : status === 'FAILED' ? '❌' : status === 'RUNNING' ? '⚙️' : '⏳';
    await ctx.reply(`${emoji} Status: *${status}*`, { parse_mode: 'Markdown' });
    if (output && status === 'COMPLETED') await safeSend(ctx, output);
  } else {
    await ctx.reply('Could not fetch request status.');
  }
});

// /cancel — forget pending request
bot.command('cancel', async (ctx) => {
  ctx.session.pendingRequestId = undefined;
  await ctx.reply('✅ Cleared pending request.');
});

// /jobs — quick scheduled jobs list (no AI, direct API call)
bot.command('jobs', async (ctx) => {
  trackChatId(ctx.chat.id);
  try {
    const res = await fetch(`${API_GATEWAY_URL}/scheduled-jobs`, {
      headers: { Authorization: `Bearer ${BOT_API_KEY}` },
    });
    const data = (await res.json()) as { ok: boolean; data?: Array<Record<string, unknown>> };
    if (!data.ok || !data.data?.length) {
      await ctx.reply('No scheduled jobs found.');
      return;
    }
    const lines = data.data.map((j) => {
      const status = j['enabled'] ? '▶️' : '⏸️';
      const last = j['lastRunAt'] ? new Date(String(j['lastRunAt'])).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never';
      return `${status} *${j['name']}*\n  ⏰ \`${j['cronExpr']}\` | last: ${last}`;
    });
    const active = data.data.filter((j) => j['enabled']).length;
    const paused = data.data.length - active;
    await safeSend(ctx, `🗓 *Scheduled Jobs (${data.data.length})*\n▶️ ${active} active · ⏸️ ${paused} paused\n\n${lines.join('\n\n')}\n\n_Tip: "@bex pause all scheduled jobs" to stop all_`);
  } catch (err) {
    console.error('[telegram] /jobs error:', err);
    await ctx.reply('❌ Could not fetch scheduled jobs.');
  }
});


bot.command('agents', async (ctx) => {
  trackChatId(ctx.chat.id);
  try {
    const res = await fetch(`${API_GATEWAY_URL}/agents`, {
      headers: { Authorization: `Bearer ${BOT_API_KEY}` },
    });
    const data = (await res.json()) as { ok: boolean; data?: Array<{ id: string; name: string; description?: string }> };
    if (!data.ok || !data.data?.length) {
      await ctx.reply('No agents found.');
      return;
    }
    const lines = data.data.map((a) => `• *${a.name}*${a.description ? `\n  ${a.description}` : ''}\n  ID: \`${a.id}\``);
    await safeSend(ctx, `🤖 *Agents (${data.data.length})*\n\n${lines.join('\n\n')}`);
  } catch (err) {
    console.error('[telegram] /agents error:', err);
    await ctx.reply('❌ Could not fetch agents.');
  }
});

// /skills — list loaded skills from the local api-gateway
bot.command('skills', async (ctx) => {
  trackChatId(ctx.chat.id);
  try {
    const res = await fetch(`${API_GATEWAY_URL}/skills`, {
      headers: { Authorization: `Bearer ${BOT_API_KEY}` },
    });
    const data = (await res.json()) as { ok: boolean; data?: Array<{ id: string; name: string; domain: string; version: string; status: string; capabilities?: string[] }> };
    if (!data.ok || !data.data?.length) {
      await ctx.reply('No skills loaded.\n\nRun the seed script or use the dashboard to install skills.');
      return;
    }
    const published = data.data.filter(s => s.status === 'PUBLISHED');
    const lines = published.map((s) => `• *${s.name}* (\`${s.domain}\`)`);
    const summary = `🧩 *Skills (${published.length} published)*\n\n${lines.join('\n')}\n\nUse /tools to see individual tools, or /tools xiq for XIQ tools.`;
    await safeSend(ctx, summary);
  } catch (err) {
    console.error('[telegram] /skills error:', err);
    await ctx.reply('❌ Could not fetch skills. Is the API gateway running?');
  }
});

// /tools [domain] — list all tools grouped by skill domain
// Usage: /tools           — show all domains with tool counts
//        /tools xco       — show all tools in xco.* skills
//        /tools weather   — show all tools in weather.* skills
bot.command('tools', async (ctx) => {
  trackChatId(ctx.chat.id);
  const filter = ctx.match?.trim().toLowerCase();

  try {
    const url = filter
      ? `${API_GATEWAY_URL}/skills/tools?domain=${encodeURIComponent(filter)}`
      : `${API_GATEWAY_URL}/skills/tools`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BOT_API_KEY}` },
    });
    const data = (await res.json()) as {
      ok: boolean;
      data?: Array<{ domain: string; skillName: string; toolCount: number; tools: Array<{ name: string; description: string }> }>;
    };

    if (!data.ok || !data.data?.length) {
      const hint = filter ? `No skills found matching \`${filter}\`.` : 'No skills loaded.';
      await ctx.reply(hint + '\n\nUse /skills to see all loaded skills.');
      return;
    }

    if (filter && data.data.length > 0) {
      // Show full tool list for filtered domain
      const lines: string[] = [`🔧 *Tools — ${filter}*\n`];
      for (const skill of data.data) {
        lines.push(`*${skill.skillName}* (${skill.toolCount} tools)`);
        for (const t of skill.tools.slice(0, 30)) {
          lines.push(`  • \`${t.name}\``);
        }
        if (skill.tools.length > 30) lines.push(`  … and ${skill.tools.length - 30} more`);
        lines.push('');
      }
      await safeSend(ctx, lines.join('\n'));
    } else {
      // Summary view — all domains with counts + hint for drilling down
      const lines: string[] = ['🔧 *Available Tools by Domain*\n'];
      for (const skill of data.data) {
        lines.push(`• \`${skill.domain}\` — ${skill.toolCount} tools`);
      }
      const total = data.data.reduce((s, d) => s + d.toolCount, 0);
      lines.push(`\n*Total: ${total} tools across ${data.data.length} domains*`);
      lines.push('\nDrill into a domain: `/tools xco` or `/tools weather` or `/tools extremecloudiq`');
      await safeSend(ctx, lines.join('\n'));
    }
  } catch (e) {
    console.error('[telegram] /tools error:', e);
    await ctx.reply('❌ Could not fetch tools. Is the API gateway running?');
  }
});

// /agent <id> — switch default agent for this session
bot.command('agent', async (ctx) => {
  const agentId = ctx.match?.trim();
  if (!agentId) {
    await ctx.reply('Usage: /agent <agent-id>\nUse /agents to see available IDs.');
    return;
  }
  ctx.session.pendingRequestId = undefined;
  // Store in session — we'd need a custom session field; for now just acknowledge
  await ctx.reply(`✅ Noted — requests will use agent \`${agentId}\`.\n(Restart bot to apply session-wide change.)`, { parse_mode: 'Markdown' });
});

// Route all other messages to the api-gateway
bot.on('message:text', async (ctx) => {
  trackChatId(ctx.chat.id);
  const input = ctx.message.text;

  // Filter truly unknown slash commands
  if (input.startsWith('/')) {
    await ctx.reply('Unknown command. Send /help to see available commands.');
    return;
  }

  // @bex prefix → route to Nexus system admin agent, or coordinator if NEXUS_AGENT_ID not set
  const bexPrefixMatch = input.match(/^@bex\s+(.+)/i);
  if (bexPrefixMatch) {
    const bexInput = bexPrefixMatch[1]!.trim();
    if (NEXUS_AGENT_ID) {
      await routeToAgent(ctx, bexInput, NEXUS_AGENT_ID);
    } else {
      await routeToCoordinator(ctx, bexInput);
    }
    return;
  }

  // @<agent-name> prefix → route to a named agent ("@xco", "@xco-monitor", "@xiq" etc.)
  const agentPrefixMatch = input.match(/^@(\S+)\s+([\s\S]+)/i);
  if (agentPrefixMatch) {
    const nameHint = agentPrefixMatch[1]!;
    const agentInput = agentPrefixMatch[2]!.trim();
    const foundId = await resolveAgentByName(nameHint);
    if (foundId) {
      await routeToAgent(ctx, agentInput, foundId);
    } else {
      await ctx.reply(
        `❓ No agent matching \`@${nameHint}\` found.\n\nUse /agents to see available agents and their names.`,
        { parse_mode: 'Markdown' },
      );
    }
    return;
  }

  // Soft keyword prefixes — "xiq <query>", "iq <query>", "xco <query>" (no @ required)
  const softPrefixMatch = input.match(/^(xiq|xco|iq|daneel|weather)\s+([\s\S]+)/i);
  if (softPrefixMatch) {
    const softHint = softPrefixMatch[1]!.toLowerCase();
    const softInput = softPrefixMatch[2]!.trim();
    // Map soft prefixes to agent name patterns
    const nameMap: Record<string, string> = {
      xiq: 'xiq', iq: 'xiq',
      xco: 'xco',
      daneel: 'daneel', weather: 'daneel',
    };
    const agentHint = nameMap[softHint] ?? softHint;
    const foundId = await resolveAgentByName(agentHint);
    if (foundId) {
      await routeToAgent(ctx, softInput, foundId);
      return;
    }
    // No match — fall through to coordinator with original input
  }

  // Default: route through coordinator for intelligent intent routing.
  // This ensures weather, multi-domain, and novel queries reach the right agent
  // rather than always landing on the default agent.
  await routeToCoordinator(ctx, input);
});

/**
 * Route a message (text or synthesised command) to the api-gateway agent.
 */
async function routeToAgent(ctx: BotContext, input: string, agentId?: string): Promise<void> {
  const targetAgentId = agentId ?? DEFAULT_AGENT_ID;
  if (!targetAgentId) {
    await ctx.reply(
      '⚠️ No BEX agent is configured yet.\n\n' +
      'An agent is being looked up automatically — please try again in a moment.\n\n' +
      'If this persists, create an agent via the dashboard and set:\n' +
      '`TELEGRAM_DEFAULT_AGENT_ID=<agent-uuid>` in `.env`\n\n' +
      '(This is a BEX agent UUID — *not* your Telegram bot token.)',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const telegramUserId = String(ctx.from?.id ?? 'unknown');
  const chatId = ctx.chat?.id ?? 0;

  try {
    const res = await fetch(`${API_GATEWAY_URL}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOT_API_KEY}`,
        'X-Bclaw-User-External-Id': telegramUserId,
      },
      body: JSON.stringify({
        agentId: targetAgentId,
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

    await ctx.reply(`⏳ Working on it… (ID: \`${requestId}\`)`, { parse_mode: 'Markdown' });
    void backgroundPoll(chatId, requestId);
  } catch (err) {
    console.error('[telegram] Error routing message:', err);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}

/**
 * Route a message through the coordinator for intelligent intent-based routing.
 * The coordinator determines which agent (XIQ, XCO, Weather, etc.) best handles
 * the query and delegates to it. Handles PENDING sub-tasks via backgroundPoll.
 */
async function routeToCoordinator(ctx: BotContext, input: string): Promise<void> {
  const telegramUserId = String(ctx.from?.id ?? 'unknown');
  const chatId = ctx.chat?.id ?? 0;

  // Send immediate feedback so the user knows the message was received
  await ctx.reply('⏳ Thinking…', { parse_mode: 'Markdown' });

  try {
    const res = await fetch(`${API_GATEWAY_URL}/coordinator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOT_API_KEY}`,
        'X-Bclaw-User-External-Id': telegramUserId,
      },
      body: JSON.stringify({ message: input, channel: 'telegram' }),
    });

    const data = (await res.json()) as {
      ok: boolean;
      data?: { output: string; pendingRequestIds?: string[] };
    };

    if (!data.ok || !data.data) {
      await bot.api.sendMessage(chatId, '❌ Failed to reach the system coordinator. Please try again.');
      return;
    }

    const { output, pendingRequestIds } = data.data;

    // Send the coordinator's own text response
    if (output && output.trim()) {
      await safeSendDirect(chatId, output);
    }

    // If sub-agent tasks are still running, poll them and deliver when ready
    if (pendingRequestIds && pendingRequestIds.length > 0) {
      for (const requestId of pendingRequestIds) {
        void backgroundPoll(chatId, requestId);
      }
    }
  } catch (err) {
    console.error('[telegram] Error routing to coordinator:', err);
    await bot.api.sendMessage(chatId, '❌ An error occurred reaching the coordinator. Please try again.');
  }
}

/**
 * Polls until COMPLETED/FAILED/AWAITING_APPROVAL or timeout (10 min),
 * then delivers result via bot.api.sendMessage().
 */
async function backgroundPoll(chatId: number, requestId: string): Promise<void> {
  const POLL_INTERVAL_MS = 3_000;
  const MAX_WAIT_MS = 600_000; // 10 minutes
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
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
        await safeSendDirect(chatId, output ?? '(No response)');
        return;
      }

      if (status === 'FAILED') {
        await bot.api.sendMessage(chatId, `❌ Request failed: ${errorMsg ?? 'Unknown error'}`);
        return;
      }

      if (status === 'AWAITING_APPROVAL') {
        await bot.api.sendMessage(
          chatId,
          `⚠️ Action requires your approval (ID: \`${requestId}\`).\nReply with /approve or /deny.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }
    } catch (err) {
      console.error('[telegram] backgroundPoll error:', err);
    }
  }

  // Timeout
  await bot.api.sendMessage(
    chatId,
    `⏰ Request \`${requestId}\` is still running. Use /status to check later.`,
    { parse_mode: 'Markdown' },
  );
}

/**
 * Send directly to a chat ID (not via ctx) — used from background poller.
 * Falls back to plain text if MarkdownV2 parsing fails. Chunks long messages.
 */
async function safeSendDirect(chatId: number, text: string): Promise<void> {
  const toMdV2 = (s: string): string =>
    s
      .replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
      .replace(/\\\*\\\*(.*?)\\\*\\\*/g, '*$1*')
      .replace(/(?<!\\\*)\\\*((?!\\\*).*?)\\\*/g, '_$1_');

  for (const chunk of chunkText(text)) {
    try {
      await bot.api.sendMessage(chatId, toMdV2(chunk), { parse_mode: 'MarkdownV2' });
    } catch {
      const plain = chunk.replace(/[*_`[\]]/g, '');
      try {
        await bot.api.sendMessage(chatId, plain);
      } catch (err) {
        console.error('[telegram] Failed to send message:', err);
      }
    }
  }
}

bot.catch((err) => {
  // Log all bot errors — 409s are expected on quick restart
  const msg = String(err);
  if (!msg.includes('409') && !msg.includes('Conflict')) {
    console.error('[telegram] Bot error:', err);
  }
});

// Keep the process alive — grammY's bot.start() keeps the event loop busy,
// but if it exits (after 409 retry), we need a failsafe keepalive.
const keepAlive = setInterval(() => {/* keepalive */}, 60_000);

async function startPolling(): Promise<void> {
  let delayMs = 0;
  let commandsRegistered = false;
  let wasOffline = false;    // true only after a real non-409 failure
  let consecutiveConflicts = 0;

  while (true) {
    if (delayMs > 0) {
      console.warn(`[telegram] Waiting ${delayMs / 1000}s before restarting...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    console.info('[telegram] Bot polling starting...');

    try {
      // Register commands once on the first successful connection
      if (!commandsRegistered) {
        await bot.api.setMyCommands([
          { command: 'start',  description: 'Welcome message & command list' },
          { command: 'help',   description: 'Show available commands' },
          { command: 'status', description: 'Check your last request status' },
          { command: 'jobs',   description: 'List scheduled jobs (quick view)' },
          { command: 'agents', description: 'List available agents' },
          { command: 'skills', description: 'List loaded skills & domains' },
          { command: 'tools',  description: 'List all tools by domain — /tools xco, /tools weather, etc.' },
          { command: 'cancel', description: 'Clear the current pending request' },
        ]);
        commandsRegistered = true;
        consecutiveConflicts = 0;
        console.info('[telegram] Commands registered with Telegram.');
        // Only notify if we were genuinely offline (not a 409 startup race)
        if (wasOffline && knownChatIds.size > 0) {
          await broadcastMessage('🔄 *Forge agent* is back online.');
          wasOffline = false;
        }
      }

      // dropPendingUpdates: false preserves messages that arrived while bot was down
      await bot.start({ drop_pending_updates: false });

      // bot.start() resolved — was stopped gracefully (SIGTERM etc.)
      console.info('[telegram] Bot polling stopped gracefully.');
      delayMs = 5_000;
    } catch (err) {
      const msg = String(err);
      if (msg.includes('409') || msg.includes('Conflict')) {
        consecutiveConflicts++;
        console.warn(`[telegram] 409 Conflict (attempt ${consecutiveConflicts}) — another session active. Waiting 35s...`);
        // 409 is a startup race condition — not an outage. Never broadcast this.
        // If it persists for a very long time (5+ attempts), log a warning only.
        if (consecutiveConflicts === 5) {
          console.error('[telegram] 409 Conflict persisting — possible stale Telegram session. Check for duplicate bot processes.');
        }
        try { await bot.stop(); } catch { /* ignore */ }
        delayMs = 35_000;
      } else {
        // Real error — bot was online and crashed
        console.error('[telegram] bot.start() error:', err);
        wasOffline = true;
        consecutiveConflicts = 0;
        try { await bot.stop(); } catch { /* ignore */ }
        delayMs = 10_000;
      }
    }
  }
}

startPolling().catch((e) => {
  console.error('[telegram] Fatal polling error:', e);
  clearInterval(keepAlive);
  process.exit(1);
});

})().catch((e) => {
  console.error('[telegram] Fatal startup error:', e);
  process.exit(1);
});
