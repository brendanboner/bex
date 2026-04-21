import { PrismaClient } from '@prisma/client';

// Shared Prisma seed for development / CI
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // System user
  const systemUser = await prisma.user.upsert({
    where: { externalId: 'system' },
    update: {},
    create: {
      externalId: 'system',
      displayName: 'System',
      email: 'system@bclaw.internal',
      isSystemUser: true,
    },
  });

  console.info('Seeded system user:', systemUser.id);

  // Default "Forge Assistant" agent — handles general requests, uses all published skills
  const defaultAgent = await prisma.agent.upsert({
    where: { id: 'default-agent' },
    update: {
      name: 'Forge Assistant',
      description: 'The system default agent. Handles general requests and automatically uses all available published skills.',
      status: 'ACTIVE',
      isDefault: true,
    },
    create: {
      id: 'default-agent',
      name: 'Forge Assistant',
      description: 'The system default agent. Handles general requests and automatically uses all available published skills.',
      status: 'ACTIVE',
      isDefault: true,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      ownerId: systemUser.id,
      persona: {
        name: 'Forge Assistant',
        tone: 'helpful and concise',
        role: 'General-purpose AI assistant with access to all skills on this Forge instance.',
      },
      permissions: ['read:all', 'schedule:jobs'],
    },
  });

  console.info('Seeded default agent:', defaultAgent.id);

  // Example endpoint (Extreme Networks XCO)
  const xcoEndpoint = await prisma.endpoint.upsert({
    where: { name: 'extreme-xco-primary' },
    update: {},
    create: {
      name: 'extreme-xco-primary',
      description: 'Extreme Networks XCO Controller (primary)',
      baseUrl: 'https://xco.example.com',
      tags: ['networking', 'extreme-xco', 'primary'],
      notes: '## Extreme XCO\nSee docs/extreme-xco.md for API details.',
    },
  });

  console.info('Seeded endpoint:', xcoEndpoint.id);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
