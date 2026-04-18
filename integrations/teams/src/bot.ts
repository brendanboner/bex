import {
  ActivityHandler,
  BotFrameworkAdapter,
  ConversationReference,
  TurnContext,
  CardFactory,
} from 'botbuilder';
import { fetch } from 'undici';

// ─── Config ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const API_GATEWAY_URL = requireEnv('API_GATEWAY_URL');
const BOT_API_KEY = requireEnv('BFORGE_BOT_API_KEY');
// Default agent is optional — if absent, user must pick with /agents
const DEFAULT_AGENT_ID = process.env['TEAMS_DEFAULT_AGENT_ID'] ?? '';

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const adapter = new BotFrameworkAdapter({
  appId: requireEnv('TEAMS_BOT_ID'),
  appPassword: requireEnv('TEAMS_BOT_PASSWORD'),
});

adapter.onTurnError = async (context, error) => {
  console.error('[teams] onTurnError:', error);
  await context.sendActivity('Sorry, an error occurred.');
};

// ─── Session state ────────────────────────────────────────────────────────────

// Map<conversationId, selectedAgentId>
const conversationAgentMap = new Map<string, string>();

// Stored conversation references for proactive messaging
const conversationRefs = new Map<string, Partial<ConversationReference>>();

// ─── API helpers ──────────────────────────────────────────────────────────────

type AgentRecord = { id: string; name: string; description?: string };
type ApiResult<T> = { ok: boolean; data?: T; error?: { message: string } };

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${API_GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${BOT_API_KEY}` },
  });
  return res.json() as Promise<ApiResult<T>>;
}

async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${API_GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_API_KEY}` },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<ApiResult<T>>;
}

// ─── Adaptive card builders ───────────────────────────────────────────────────

function agentListCard(agents: AgentRecord[]) {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '🤖 Available Agents', weight: 'Bolder', size: 'Medium' },
      ...agents.map(a => ({
        type: 'TextBlock',
        text: `**${a.name}** — ${a.description ?? 'No description'}`,
        wrap: true,
      })),
    ],
    actions: agents.map(a => ({
      type: 'Action.Submit',
      title: a.name,
      data: { action: 'selectAgent', agentId: a.id },
    })),
  });
}

function requestQueuedCard(requestId: string, agentId: string) {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '✅ Request queued', weight: 'Bolder' },
      { type: 'TextBlock', text: `**ID:** \`${requestId}\``, wrap: true },
      { type: 'TextBlock', text: `**Agent:** ${agentId}`, wrap: true },
      { type: 'TextBlock', text: 'You will be notified when it completes.', wrap: true },
    ],
    actions: [
      { type: 'Action.Submit', title: '🔍 Check Status', data: { action: 'checkStatus', requestId } },
    ],
  });
}

function statusCard(requestId: string, status: string, result?: string) {
  const body: unknown[] = [
    { type: 'TextBlock', text: `📋 Request Status`, weight: 'Bolder' },
    { type: 'TextBlock', text: `**ID:** \`${requestId}\``, wrap: true },
    { type: 'TextBlock', text: `**Status:** ${status}`, wrap: true },
  ];
  if (result) {
    body.push({ type: 'TextBlock', text: `**Result:**\n\n${result}`, wrap: true });
  }
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

function helpCard() {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '📖 Forge Bot Help', weight: 'Bolder', size: 'Medium' },
      { type: 'TextBlock', text: 'Send any message to route it to the selected agent.', wrap: true },
      {
        type: 'FactSet',
        facts: [
          { title: '/agents', value: 'List available agents and select one' },
          { title: '/status [id]', value: 'Check the status of a request' },
          { title: '/help', value: 'Show this help card' },
        ],
      },
    ],
  });
}

function resultCard(requestId: string, result: string) {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '✅ Request Complete', weight: 'Bolder' },
      { type: 'TextBlock', text: `**ID:** \`${requestId}\``, wrap: true },
      { type: 'TextBlock', text: result, wrap: true },
    ],
  });
}

function approvalCard(payload: {
  requestId: string;
  requestedBy?: string;
  action?: string;
  reason?: string;
}) {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '⚠️ Approval Required', weight: 'Bolder', color: 'Warning' },
      { type: 'TextBlock', text: `**Request ID:** \`${payload.requestId}\``, wrap: true },
      ...(payload.requestedBy
        ? [{ type: 'TextBlock', text: `**Requested by:** ${payload.requestedBy}`, wrap: true }]
        : []),
      ...(payload.action
        ? [{ type: 'TextBlock', text: `**Action:** ${payload.action}`, wrap: true }]
        : []),
      ...(payload.reason
        ? [{ type: 'TextBlock', text: `**Reason:** ${payload.reason}`, wrap: true }]
        : []),
    ],
    actions: [
      { type: 'Action.Submit', title: '✅ Approve', style: 'positive', data: { action: 'approve', requestId: payload.requestId } },
      { type: 'Action.Submit', title: '❌ Reject', style: 'destructive', data: { action: 'reject', requestId: payload.requestId } },
    ],
  });
}

// ─── Polling helper ───────────────────────────────────────────────────────────

type RequestRecord = { id: string; status: string; result?: string; output?: string };

async function pollAndNotify(requestId: string, convId: string): Promise<void> {
  const maxAttempts = 60;
  let attempts = 0;

  const check = async (): Promise<void> => {
    if (attempts++ >= maxAttempts) return;

    try {
      const resp = await apiGet<RequestRecord>(`/requests/${requestId}`);
      if (!resp.ok || !resp.data) return;

      const { status, result, output } = resp.data;

      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
        const ref = conversationRefs.get(convId);
        if (!ref) return;

        await adapter.continueConversation(ref, async (ctx) => {
          const text = result ?? output ?? (status === 'FAILED' ? '❌ Request failed.' : 'No output.');
          await ctx.sendActivity({ attachments: [resultCard(requestId, text)] });
        });
        return;
      }

      // Still running — check again in 5 seconds
      setTimeout(() => void check(), 5000);
    } catch (err) {
      console.error('[teams] Poll error:', err);
    }
  };

  setTimeout(() => void check(), 3000);
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

class TeamsBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const activity = context.activity;
      const convId = activity.conversation.id;

      // Store conversation reference for proactive messages
      conversationRefs.set(convId, TurnContext.getConversationReference(activity));

      // Handle Adaptive Card invoke/submit actions
      if (activity.type === 'invoke' || activity.value) {
        await this.handleCardAction(context, convId);
        await next();
        return;
      }

      const input = activity.text?.trim() ?? '';
      if (!input) { await next(); return; }

      // ── Commands ────────────────────────────────────────────────────────────

      if (input.toLowerCase() === '/help') {
        await context.sendActivity({ attachments: [helpCard()] });
        await next();
        return;
      }

      if (input.toLowerCase() === '/agents') {
        await this.handleAgentsCommand(context);
        await next();
        return;
      }

      if (input.toLowerCase().startsWith('/status')) {
        const parts = input.split(/\s+/);
        const requestId = parts[1];
        await this.handleStatusCommand(context, requestId);
        await next();
        return;
      }

      // ── Route message to agent ─────────────────────────────────────────────

      const agentId = conversationAgentMap.get(convId) || DEFAULT_AGENT_ID;
      if (!agentId) {
        await context.sendActivity(
          '⚠️ No agent selected. Use `/agents` to pick one.',
        );
        await this.handleAgentsCommand(context);
        await next();
        return;
      }

      await this.routeMessage(context, convId, agentId, input);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded ?? []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity({ attachments: [helpCard()] });
        }
      }
      await next();
    });
  }

  private async handleCardAction(context: TurnContext, convId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = context.activity.value as Record<string, any> | undefined;
    if (!value) return;

    const action = value['action'] as string | undefined;

    if (action === 'selectAgent') {
      const agentId = value['agentId'] as string;
      conversationAgentMap.set(convId, agentId);
      await context.sendActivity(`✅ Agent **${agentId}** selected. Send your message!`);
      return;
    }

    if (action === 'checkStatus') {
      const requestId = value['requestId'] as string | undefined;
      await this.handleStatusCommand(context, requestId);
      return;
    }

    if (action === 'approve' || action === 'reject') {
      const requestId = value['requestId'] as string;
      await this.handleApprovalResponse(context, requestId, action);
      return;
    }
  }

  private async handleAgentsCommand(context: TurnContext): Promise<void> {
    try {
      const resp = await apiGet<AgentRecord[]>('/agents');
      if (!resp.ok || !resp.data || resp.data.length === 0) {
        await context.sendActivity('⚠️ No agents available.');
        return;
      }
      await context.sendActivity({ attachments: [agentListCard(resp.data)] });
    } catch (err) {
      console.error('[teams] /agents error:', err);
      await context.sendActivity('❌ Failed to fetch agents.');
    }
  }

  private async handleStatusCommand(context: TurnContext, requestId?: string): Promise<void> {
    if (!requestId) {
      await context.sendActivity('Usage: `/status <requestId>`');
      return;
    }
    try {
      const resp = await apiGet<RequestRecord>(`/requests/${requestId}`);
      if (!resp.ok || !resp.data) {
        await context.sendActivity(`❌ Request \`${requestId}\` not found.`);
        return;
      }
      const { status, result, output } = resp.data;
      await context.sendActivity({ attachments: [statusCard(requestId, status, result ?? output)] });
    } catch (err) {
      console.error('[teams] /status error:', err);
      await context.sendActivity('❌ Failed to fetch status.');
    }
  }

  private async routeMessage(
    context: TurnContext,
    convId: string,
    agentId: string,
    input: string,
  ): Promise<void> {
    try {
      const resp = await apiPost<{ requestId: string }>('/requests', {
        agentId,
        input,
        channel: 'teams',
        externalUserId: context.activity.from.id,
      });

      if (resp.ok && resp.data) {
        const { requestId } = resp.data;
        await context.sendActivity({ attachments: [requestQueuedCard(requestId, agentId)] });
        pollAndNotify(requestId, convId);
      } else {
        await context.sendActivity('❌ Failed to queue request. Please try again.');
      }
    } catch (err) {
      console.error('[teams] routeMessage error:', err);
      await context.sendActivity('❌ An error occurred. Please try again.');
    }
  }

  private async handleApprovalResponse(
    context: TurnContext,
    requestId: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    try {
      const endpoint = decision === 'approve'
        ? `/approvals/${requestId}/approve`
        : `/approvals/${requestId}/reject`;

      const resp = await apiPost<unknown>(endpoint, {
        approvedBy: context.activity.from.name ?? context.activity.from.id,
      });

      if (resp.ok) {
        await context.sendActivity(
          decision === 'approve'
            ? `✅ Request \`${requestId}\` approved.`
            : `❌ Request \`${requestId}\` rejected.`,
        );
      } else {
        await context.sendActivity('⚠️ Failed to record decision.');
      }
    } catch (err) {
      console.error('[teams] approval response error:', err);
      await context.sendActivity('❌ An error occurred recording your decision.');
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const bot = new TeamsBot();

export async function handleActivity(
  req: Parameters<typeof adapter.processActivity>[0],
  res: Parameters<typeof adapter.processActivity>[1],
): Promise<void> {
  await adapter.processActivity(req, res, async (context: TurnContext) => {
    await bot.run(context);
  });
}

/**
 * Send an approval request to a specific Teams conversation as an Adaptive Card.
 * Called by the permission-gateway webhook handler.
 */
export async function sendApprovalRequest(
  conversationId: string,
  payload: { requestId: string; requestedBy?: string; action?: string; reason?: string },
): Promise<void> {
  const ref = conversationRefs.get(conversationId);
  if (!ref) throw new Error(`No conversation reference for id: ${conversationId}`);

  await adapter.continueConversation(ref, async (ctx) => {
    await ctx.sendActivity({ attachments: [approvalCard(payload)] });
  });
}

