import type { ApprovalPayload } from '@bclaw/shared';

export interface NotificationAdapter {
  /**
   * Send a new approval request notification.
   * Returns an adapter-specific reference (e.g. Telegram message_id) for later update.
   */
  sendApprovalRequest(payload: ApprovalPayload): Promise<string | null>;

  /**
   * Update the notification after a decision has been made (approved/denied/expired).
   */
  updateApprovalStatus(channelRef: string, status: 'APPROVED' | 'DENIED' | 'EXPIRED'): Promise<void>;
}

// ─── Telegram adapter ────────────────────────────────────────────────────────

export class TelegramAdapter implements NotificationAdapter {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly callbackBaseUrl: string;

  constructor() {
    this.botToken = requireEnv('TELEGRAM_BOT_TOKEN');
    this.chatId = requireEnv('TELEGRAM_APPROVAL_CHAT_ID');
    this.callbackBaseUrl = requireEnv('PERMISSION_GATEWAY_CALLBACK_URL');
  }

  async sendApprovalRequest(payload: ApprovalPayload): Promise<string | null> {
    const { fetch } = await import('undici');

    const text = [
      `🔐 *Approval Required*`,
      ``,
      `*Agent:* ${payload.agentName}`,
      `*Reason:* ${payload.reason}`,
      `*Expires:* ${payload.expiresAt.toISOString()}`,
    ].join('\n');

    const approveUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/approve`;
    const denyUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/deny`;

    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', url: approveUrl },
            { text: '❌ Deny', url: denyUrl },
          ],
        ],
      },
    };

    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('Telegram sendMessage failed', await res.text());
      return null;
    }

    const data = (await res.json()) as { result?: { message_id?: number } };
    return String(data.result?.message_id ?? '');
  }

  async updateApprovalStatus(channelRef: string, status: 'APPROVED' | 'DENIED' | 'EXPIRED'): Promise<void> {
    const { fetch } = await import('undici');

    const emoji = status === 'APPROVED' ? '✅' : status === 'DENIED' ? '❌' : '⏰';
    const label = status === 'APPROVED' ? 'Approved' : status === 'DENIED' ? 'Denied' : 'Expired';

    await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        message_id: Number(channelRef),
        reply_markup: { inline_keyboard: [[{ text: `${emoji} ${label}`, callback_data: 'noop' }]] },
      }),
    });
  }
}

// ─── Teams adapter ────────────────────────────────────────────────────────────

export class TeamsAdapter implements NotificationAdapter {
  private readonly webhookUrl: string;
  private readonly callbackBaseUrl: string;

  constructor() {
    this.webhookUrl = requireEnv('TEAMS_APPROVAL_WEBHOOK_URL');
    this.callbackBaseUrl = requireEnv('PERMISSION_GATEWAY_CALLBACK_URL');
  }

  async sendApprovalRequest(payload: ApprovalPayload): Promise<string | null> {
    const { fetch } = await import('undici');

    const approveUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/approve`;
    const denyUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/deny`;

    // Adaptive Card payload for Teams
    const card = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: '🔐 Approval Required', weight: 'Bolder', size: 'Medium' },
              { type: 'TextBlock', text: `**Agent:** ${payload.agentName}` },
              { type: 'TextBlock', text: `**Reason:** ${payload.reason}` },
              { type: 'TextBlock', text: `**Expires:** ${payload.expiresAt.toISOString()}` },
            ],
            actions: [
              { type: 'Action.OpenUrl', title: '✅ Approve', url: approveUrl },
              { type: 'Action.OpenUrl', title: '❌ Deny', url: denyUrl },
            ],
          },
        },
      ],
    };

    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    return null; // Teams webhooks don't return a ref we can update
  }

  async updateApprovalStatus(_channelRef: string, _status: 'APPROVED' | 'DENIED' | 'EXPIRED'): Promise<void> {
    // Teams incoming webhooks are one-way; no update possible without a bot framework
  }
}

// ─── WhatsApp adapter (Twilio) ────────────────────────────────────────────────

export class WhatsAppAdapter implements NotificationAdapter {
  private readonly callbackBaseUrl: string;
  private readonly fromNumber: string;
  private readonly toNumber: string;

  constructor() {
    this.callbackBaseUrl = requireEnv('PERMISSION_GATEWAY_CALLBACK_URL');
    this.fromNumber = requireEnv('TWILIO_WHATSAPP_FROM');
    this.toNumber = requireEnv('WHATSAPP_APPROVAL_TO');
  }

  async sendApprovalRequest(payload: ApprovalPayload): Promise<string | null> {
    const twilio = (await import('twilio')).default;
    const client = twilio(requireEnv('TWILIO_ACCOUNT_SID'), requireEnv('TWILIO_AUTH_TOKEN'));

    const approveUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/approve`;
    const denyUrl = `${this.callbackBaseUrl}/approvals/${payload.requestId}/deny`;

    const body = [
      `🔐 *Approval Required*`,
      ``,
      `*Agent:* ${payload.agentName}`,
      `*Reason:* ${payload.reason}`,
      `*Expires:* ${payload.expiresAt.toISOString()}`,
      ``,
      `✅ Approve: ${approveUrl}`,
      `❌ Deny: ${denyUrl}`,
      ``,
      `Or reply *APPROVE ${payload.requestId}* or *DENY ${payload.requestId}* to this message.`,
    ].join('\n');

    const message = await client.messages.create({
      from: this.fromNumber,
      to: this.toNumber,
      body,
    });

    return message.sid;
  }

  async updateApprovalStatus(channelRef: string, status: 'APPROVED' | 'DENIED' | 'EXPIRED'): Promise<void> {
    const twilio = (await import('twilio')).default;
    const client = twilio(requireEnv('TWILIO_ACCOUNT_SID'), requireEnv('TWILIO_AUTH_TOKEN'));

    const emoji = status === 'APPROVED' ? '✅' : status === 'DENIED' ? '❌' : '⏰';
    const label = status === 'APPROVED' ? 'Approved' : status === 'DENIED' ? 'Denied' : 'Expired';

    await client.messages.create({
      from: this.fromNumber,
      to: this.toNumber,
      body: `${emoji} Approval request ${channelRef} has been *${label}*.`,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
