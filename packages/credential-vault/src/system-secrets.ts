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
  'system.ollama_base_url':       ['OLLAMA_BASE_URL'],
  'system.telegram_bot_token':    ['TELEGRAM_BOT_TOKEN'],
  'system.xiq_credentials':       ['XIQ_USERNAME', 'XIQ_PASSWORD'],
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

  const injected = new Set<string>();
  const missing = new Set<string>();
  
  for (const cred of credentials) {
    const envKeys = SYSTEM_CREDENTIAL_MAP[cred.name];
    if (!envKeys) continue;
    try {
      const values = decrypt({ encryptedValue: cred.encryptedValue, iv: cred.iv, authTag: cred.authTag });
      let found = false;
      for (const envKey of envKeys) {
        const lower = values[envKey.toLowerCase()];
        const exact = values[envKey];
        if (!process.env[envKey]) {
          if (lower !== undefined) {
            process.env[envKey] = String(lower);
            injected.add(envKey);
            found = true;
          } else if (exact !== undefined) {
            process.env[envKey] = String(exact);
            injected.add(envKey);
            found = true;
          }
        } else {
          injected.add(envKey);
          found = true;
        }
      }
      if (found) {
        console.info(`[vault] Loaded system secret: ${cred.name}`);
      } else {
        missing.add(cred.name);
      }
    } catch (err) {
      console.warn(`[vault] Could not decrypt system secret: ${cred.name} — ${(err as Error).message}`);
      missing.add(cred.name);
    }
  }

  // Warn about expected system secrets that are missing
  const expected = ['system.openai_api_key', 'system.anthropic_api_key', 'system.azure_openai_api_key'];
  const missingLlmKeys = expected.filter(k => missing.has(k));
  if (missingLlmKeys.length > 0) {
    console.warn('[vault] Missing LLM system secrets:', missingLlmKeys.join(', '));
  }
}
