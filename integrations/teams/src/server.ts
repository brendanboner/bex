import * as restify from 'restify';
import { handleActivity } from './bot.js';

const PORT = Number(process.env['PORT'] ?? 3978);

async function main(): Promise<void> {
  const server = restify.createServer({ name: 'bclaw-teams-bot' });

  server.use(restify.plugins.bodyParser());

  // Bot Framework messaging endpoint
  server.post('/api/messages', async (req, res) => {
    await handleActivity(req, res);
  });

  server.listen(PORT, () => {
    console.info(`[teams] Bot server listening on port ${PORT}`);
  });
}

void main();
