import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const existing = await p.user.findFirst({ where: { externalId: 'telegram-bot' } });
  if (existing) {
    console.log('telegram-bot user exists:', existing.id);
    return;
  }
  const u = await p.user.create({
    data: {
      externalId: 'telegram-bot',
      email: 'telegram-bot@forge.internal',
      displayName: 'Telegram Bot',
      isSystemUser: true,
    },
  });
  console.log('Created telegram-bot user:', u.id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
