/**
 * seed-weather.ts — Creates the weather forecast skill and agent
 * Run: cd packages/shared && npx tsx ../../scripts/seed-weather.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WEATHER_TOOLS = [
  {
    name: 'get_location_from_ip',
    description:
      'Determine the geographic location (city, country, latitude, longitude) of the current machine using its public IP address. Use this first to find the user\'s location.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handlerType: 'public_http_call',
    config: {
      method: 'GET',
      urlTemplate: 'http://ip-api.com/json',
    },
  },
  {
    name: 'get_weather_forecast',
    description:
      'Get the current weather conditions and hourly/daily forecast for a given latitude and longitude using the Open-Meteo API (free, no key required).',
    parameters: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitude of the location (e.g. 53.3498 for Dublin)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude of the location (e.g. -6.2603 for Dublin)',
        },
        current: {
          type: 'string',
          description:
            'Comma-separated list of current weather variables. Default: temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature',
        },
        hourly: {
          type: 'string',
          description:
            'Comma-separated list of hourly forecast variables (optional). E.g. temperature_2m,precipitation_probability',
        },
        daily: {
          type: 'string',
          description:
            'Comma-separated list of daily forecast variables (optional). E.g. temperature_2m_max,temperature_2m_min,precipitation_sum',
        },
        forecast_days: {
          type: 'number',
          description: 'Number of forecast days (1–16). Default: 3',
        },
        timezone: {
          type: 'string',
          description: 'Timezone for results, e.g. "Europe/Dublin". Default: auto',
        },
      },
      required: ['latitude', 'longitude'],
    },
    handlerType: 'public_http_call',
    config: {
      method: 'GET',
      // Open-Meteo uses query params; the handler replaces {param} tokens but for GET
      // requests with many optional params we pass them as a constructed URL template.
      // The tool-registry will substitute {latitude} and {longitude}; remaining are set
      // via defaults so the URL template covers the common case.
      urlTemplate:
        'https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&forecast_days=3&timezone=auto',
    },
  },
];

const SYSTEM_PROMPT = `You are a helpful weather assistant. When asked about the weather:
1. Call get_location_from_ip to determine the user's current location.
2. Call get_weather_forecast with the returned latitude and longitude.
3. Interpret the WMO weather_code values:
   - 0: Clear sky, 1-3: Mainly clear/partly cloudy/overcast, 45-48: Fog, 51-67: Drizzle/Rain, 71-77: Snow, 80-82: Rain showers, 85-86: Snow showers, 95: Thunderstorm
4. Present a friendly, readable summary: current temperature, feels-like, conditions, wind, and a brief 3-day outlook.
5. Always mention the detected city so the user knows which location was used.
Keep responses concise and clear — suitable for a Telegram message.`;

async function main() {
  console.log('Creating weather skill...');

  // Upsert by domain+version
  const existing = await prisma.skill.findUnique({
    where: { domain_version: { domain: 'weather.forecast', version: '1.0.0' } },
  });

  let skill;
  if (existing) {
    skill = await prisma.skill.update({
      where: { id: existing.id },
      data: {
        name: 'Weather Forecast',
        description:
          'Provides current weather conditions and short-range forecasts for any location using the public IP address for automatic location detection.',
        status: 'PUBLISHED',
        capabilities: [
          'get-current-weather',
          'get-weather-forecast',
          'detect-location-from-ip',
          'get-weather-by-coordinates',
        ],
        tools: WEATHER_TOOLS as object[],
        systemPrompt: SYSTEM_PROMPT,
        requiredCredentialType: null,
      },
    });
    console.log(`  ✓ Updated existing skill: ${skill.id}`);
  } else {
    skill = await prisma.skill.create({
      data: {
        name: 'Weather Forecast',
        domain: 'weather.forecast',
        version: '1.0.0',
        description:
          'Provides current weather conditions and short-range forecasts for any location using the public IP address for automatic location detection.',
        status: 'PUBLISHED',
        capabilities: [
          'get-current-weather',
          'get-weather-forecast',
          'detect-location-from-ip',
          'get-weather-by-coordinates',
        ],
        tools: WEATHER_TOOLS as object[],
        systemPrompt: SYSTEM_PROMPT,
        requiredCredentialType: null,
      },
    });
    console.log(`  ✓ Created skill: ${skill.id}`);
  }

  // Find or create system user for agent ownership
  let systemUser = await prisma.user.findFirst({ where: { externalId: 'system' } });
  if (!systemUser) {
    systemUser = await prisma.user.findFirst({ where: { email: 'admin@bex.local' } });
  }
  if (!systemUser) {
    throw new Error('No system or admin user found — run bex init first');
  }

  console.log('Creating weather agent...');

  // Upsert agent by name
  let agent = await prisma.agent.findFirst({ where: { name: 'Weather Forecaster' } });
  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        name: 'Weather Forecaster',
        description:
          'Fetches the current weather forecast for your location, automatically detected from your IP address. Uses Open-Meteo for forecasts (free, no API key needed).',
        status: 'ACTIVE',
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        persona: { systemPrompt: SYSTEM_PROMPT },
        owner: { connect: { id: systemUser.id } },
      },
    });
    console.log(`  ✓ Created agent: ${agent.id}`);
  } else {
    agent = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        status: 'ACTIVE',
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        persona: { systemPrompt: SYSTEM_PROMPT },
      },
    });
    console.log(`  ✓ Updated agent: ${agent.id}`);
  }

  // Link skill to agent
  const existing_link = await prisma.agentSkill.findUnique({
    where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
  });
  if (!existing_link) {
    await prisma.agentSkill.create({ data: { agentId: agent.id, skillId: skill.id } });
    console.log(`  ✓ Linked skill to agent`);
  } else {
    console.log(`  ✓ Skill already linked`);
  }

  console.log('');
  console.log('=================================================');
  console.log(`  Skill ID:  ${skill.id}`);
  console.log(`  Agent ID:  ${agent.id}`);
  console.log('=================================================');
  console.log('');
  console.log('Now update your .env / Telegram bot:');
  console.log(`  TELEGRAM_DEFAULT_AGENT_ID=${agent.id}`);
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
