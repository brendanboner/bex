import { buildWebhookServer } from './webhook.js';

const PORT = Number(process.env['PORT'] ?? 3980);

async function main(): Promise<void> {
  const app = buildWebhookServer();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.info(`[whatsapp] Webhook server listening on port ${PORT}`);
}

void main();
