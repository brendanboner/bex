import type { PrismaClient } from '@prisma/client';
import { decrypt } from './crypto.js';

/**
 * Well-known system credential names stored in the vault.
 * Each maps to one or more process.env keys that services expect.
 */
const SYSTEM_CREDENTIAL_MAP: Record<string, string[]> = {
  'system.openai_api_key':        ['OPENAI_API_KEY'],
  'system.anthropic_api_key':     ['ANTHROPIC_API_KEY'],
  'system.azure_openai_api_key':  ['AZURE_OPENAI_API_KEY'],
  'system.telegram_bot_token':    ['TELEGRAM_BOT_TOKEN'],
  'system.xciq_credentials':      ['XCIQ_USERNAME', 'XCIQ_PASSWORD'],
  'system.xco_credentials':       ['XCO_HOST', 'XCO_USERNAME', 'XCO_PASSWORD'],
  'system.twilio_credentials':    ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'WHATSAPP_APPROVAL_TO'],
};

/**
 * Reads all well-known system credentials from the vault and injects their
 * values into process.env. Only populates keys that aren't already set, so
 * env vars always take precedence (e.g. during local development).
 *
 * Call this once at service startup, before any LLM or integration code runs.
 */
export async function loadSystemSecrets(prisma: PrismaClient): Promise<void> {
  const names = Object.keys(SYSTEM_CREDENTIAL_MAP);

  let credentials: Array<{ name: string; encryptedValue: string; iv: string; authTag: string }>;
  try {
    credentials = await prisma.credential.findMany({
      where: { name: { in: names }, scope: 'SYSTEM' },
      select: { name: true, encryptedValue: true, iv: true, authTag: true },
    });
  } catch (err) {
    // DB not reachable yet — skip silently, env vars will be used instead
    console.warn('[vault] Could not load system secrets:', (err as Error).message);
    return;
  }

  for (const cred of credentials) {
    const envKeys = SYSTEM_CREDENTIAL_MAP[cred.name];
    if (!envKeys) continue;
    try {
      const values = decrypt({ encryptedValue: cred.encryptedValue, iv: cred.iv, authTag: cred.authTag });
      for (const envKey of envKeys) {
        if (!process.env[envKey] && values[envKey.toLowerCase()] !== undefined) {
          process.env[envKey] = String(values[envKey.toLowerCase()]);
        }
      }
    } catch {
      console.warn(`[vault] Could not decrypt system secret: ${cred.name}`);
    }
  }
}
