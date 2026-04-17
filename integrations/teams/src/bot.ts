import {
  ActivityHandler,
  BotFrameworkAdapter,
  TurnContext,
  CardFactory,
  type Activity,
} from 'botbuilder';
import { fetch } from 'undici';

const API_GATEWAY_URL = requireEnv('API_GATEWAY_URL');
const DEFAULT_AGENT_ID = requireEnv('TEAMS_DEFAULT_AGENT_ID');
const BOT_API_KEY = requireEnv('BCLAW_BOT_API_KEY');

export const adapter = new BotFrameworkAdapter({
  appId: requireEnv('TEAMS_BOT_ID'),
  appPassword: requireEnv('TEAMS_BOT_PASSWORD'),
});

adapter.onTurnError = async (context, error) => {
  console.error('[teams] onTurnError:', error);
  await context.sendActivity('Sorry, an error occurred.');
};

class TeamsBot extends ActivityHandler {
  constructor() {
    super();

    // Handle incoming text messages — route to api-gateway
    this.onMessage(async (context, next) => {
      const activity = context.activity;

      // Ignore invoke activities (adaptive card submissions handled separately)
      if (activity.type !== 'message') {
        await next();
        return;
      }

      const input = activity.text?.trim();
      if (!input) {
        await next();
        return;
      }

      const teamsUserId = activity.from.id;

      try {
        const res = await fetch(`${API_GATEWAY_URL}/requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOT_API_KEY}`,
            'X-Bclaw-User-External-Id': teamsUserId,
          },
          body: JSON.stringify({
            agentId: DEFAULT_AGENT_ID,
            input,
            channel: 'teams',
          }),
        });

        const data = (await res.json()) as { ok: boolean; data?: { requestId: string } };

        if (data.ok && data.data) {
          const card = CardFactory.adaptiveCard({
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: `✅ Request queued`,
                weight: 'Bolder',
              },
              {
                type: 'TextBlock',
                text: `**ID:** \`${data.data.requestId}\``,
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: 'Your request is being processed. You will be notified when it completes.',
                wrap: true,
              },
            ],
          });

          await context.sendActivity({ attachments: [card] });
        } else {
          await context.sendActivity('❌ Failed to queue request. Please try again.');
        }
      } catch (err) {
        console.error('[teams] Error routing message:', err);
        await context.sendActivity('❌ An error occurred. Please try again.');
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded ?? []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            '👋 Welcome to bclaw! Send me any message and I\'ll route it to your agent.',
          );
        }
      }
      await next();
    });
  }
}

export const bot = new TeamsBot();

/**
 * Handle an incoming Bot Framework activity from the restify server.
 */
export async function handleActivity(req: Parameters<typeof adapter.processActivity>[0], res: Parameters<typeof adapter.processActivity>[1]): Promise<void> {
  await adapter.processActivity(req, res, async (context: TurnContext) => {
    await bot.run(context);
  });
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
