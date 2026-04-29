/**
 * seed-domain-intelligence.ts
 *
 * Seeds the DomainKnowledge table with entity graphs and playbooks for the
 * `extremecloudiq` and `networking` domains. Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/seed-domain-intelligence.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) config({ path: envPath });

export { seedDomainIntelligence } from '../packages/api-gateway/src/domain-intelligence.js';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('[DOMAIN-INTEL] Dry-run mode — script loaded and parsed successfully.');
    return;
  }

  const { seedDomainIntelligence } = await import('../packages/api-gateway/src/domain-intelligence.js');
  const prisma = new PrismaClient();
  try {
    await seedDomainIntelligence(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[DOMAIN-INTEL] Fatal error:', err);
  process.exit(1);
});
