import twilio from 'twilio';
import type { ApprovalPayload } from '@bex/shared';

const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
const authToken = requireEnv('TWILIO_AUTH_TOKEN');
const fromNumber = requireEnv('TWILIO_WHATSAPP_FROM');
const toNumber = requireEnv('WHATSAPP_APPROVAL_TO');

const client = twilio(accountSid, authToken);

export class WhatsAppAdapter {
  async sendApprovalRequest(payload: ApprovalPayload): Promise<string | null> {
    const approveUrl = `${requireEnv('PERMISSION_GATEWAY_CALLBACK_URL')}/approvals/${payload.requestId}/approve`;
    const denyUrl = `${requireEnv('PERMISSION_GATEWAY_CALLBACK_URL')}/approvals/${payload.requestId}/deny`;

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
      `Or reply *APPROVE* or *DENY* to this message.`,
    ].join('\n');

    const message = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body,
    });

    return message.sid;
  }

  async updateApprovalStatus(channelRef: string, status: 'APPROVED' | 'DENIED' | 'EXPIRED'): Promise<void> {
    const emoji = status === 'APPROVED' ? '✅' : status === 'DENIED' ? '❌' : '⏰';
    const label = status === 'APPROVED' ? 'Approved' : status === 'DENIED' ? 'Denied' : 'Expired';

    await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body: `${emoji} Approval request ${channelRef} has been *${label}*.`,
    });
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
