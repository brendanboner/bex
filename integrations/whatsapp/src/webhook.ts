import Fastify from 'fastify';
import { fetch } from 'undici';

const BFORGE_API_URL = process.env.BEX_API_URL ?? requireEnv('API_GATEWAY_URL');

export function buildWebhookServer(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true });

  // Twilio sends webhook POSTs as application/x-www-form-urlencoded
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const parsed = Object.fromEntries(new URLSearchParams(body as string));
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post('/webhook/whatsapp', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const incomingBody = (body['Body'] ?? '').trim().toUpperCase();
    const from = body['From'] ?? '';

    // Try to extract a request ID if the user includes it (e.g. "APPROVE abc123")
    const parts = incomingBody.split(/\s+/);
    const command = parts[0];
    const requestId = parts[1];

    if (command !== 'APPROVE' && command !== 'DENY') {
      await reply.status(200).send('<Response></Response>');
      return;
    }

    if (!requestId) {
      // Can't act without a request ID — just acknowledge
      await reply.status(200).send('<Response></Response>');
      return;
    }

    const action = command === 'APPROVE' ? 'approve' : 'deny';

    try {
      const res = await fetch(`${BFORGE_API_URL}/requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from }),
      });

      if (!res.ok) {
        console.error(`[whatsapp] Failed to ${action} request ${requestId}:`, await res.text());
      }
    } catch (err) {
      console.error('[whatsapp] Webhook error:', err);
    }

    // Twilio expects an empty TwiML response to suppress any auto-reply
    await reply
      .status(200)
      .header('Content-Type', 'text/xml')
      .send('<Response></Response>');
  });

  return app;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
