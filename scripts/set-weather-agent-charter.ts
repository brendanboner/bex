import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const agent = await p.agent.findFirst({ where: { name: 'Weather Forecaster' } });
  if (!agent) {
    console.error('Weather Forecaster agent not found. Run seed-weather.ts first.');
    process.exit(1);
  }

  if (agent.charterId) {
    // Update existing charter
    await p.agentCharter.update({
      where: { id: agent.charterId },
      data: {
        posture: 'AUTONOMOUS',
        mandate:
          'You are a weather forecasting assistant. Use ip-api.com to detect the user\'s location, then query Open-Meteo for a weather forecast. Always present a friendly, readable summary.',
        bearing: 'CONCISE',
        verbosity: 'STANDARD',
        conductBoundaries: [],
      },
    });
    console.log('Updated existing charter to AUTONOMOUS posture');
  } else {
    const charter = await p.agentCharter.create({
      data: {
        posture: 'AUTONOMOUS',
        mandate:
          'You are a weather forecasting assistant. Use ip-api.com to detect the user\'s location, then query Open-Meteo for a weather forecast. Always present a friendly, readable summary.',
        bearing: 'CONCISE',
        verbosity: 'STANDARD',
        conductBoundaries: [],
      },
    });
    await p.agent.update({ where: { id: agent.id }, data: { charterId: charter.id } });
    console.log(`Created AUTONOMOUS charter: ${charter.id} → linked to agent ${agent.id}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
