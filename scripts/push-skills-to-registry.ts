/**
 * push-skills-to-registry.ts
 *
 * Pushes all local PUBLISHED skills to the remote skill registry via the
 * running api-gateway. The gateway already has the registry token loaded from
 * the vault at startup, so no credentials are needed here.
 *
 * Usage:
 *   npx tsx scripts/push-skills-to-registry.ts
 *
 * Optional env overrides:
 *   API_URL=http://localhost:4000    (default)
 *   DOMAIN_FILTER=extremecloudiq.   (push only matching domain prefix)
 *   DRY_RUN=true                    (show what would be pushed, don't push)
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });

const API_URL      = (process.env['API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
const DOMAIN_FILTER = process.env['DOMAIN_FILTER'] ?? '';
const DRY_RUN      = process.env['DRY_RUN'] === 'true';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  // Prefer bot API key (already a valid JWT, no login needed)
  const botKey = process.env['BEX_BOT_API_KEY'];
  if (botKey) return botKey;

  const email    = process.env['BEX_ADMIN_EMAIL'];
  const password = process.env['BEX_ADMIN_PASSWORD'];
  if (!email || !password) {
    throw new Error('Set BEX_ADMIN_EMAIL + BEX_ADMIN_PASSWORD in .env (or BEX_BOT_API_KEY)');
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as { ok: boolean; data?: { token?: string } };
  if (!json.ok || !json.data?.token) throw new Error('Login failed');
  return json.data.token;
}

// ── Registry state ─────────────────────────────────────────────────────────

interface RegistrySkill { domain: string; version: string }

async function getRegistrySkills(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`${API_URL}/registry/skills`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { ok: boolean; data?: RegistrySkill[] };
    for (const s of json.data ?? []) map.set(s.domain, s.version);
  } catch (e) {
    console.warn('⚠️  Could not list registry skills:', (e as Error).message);
  }
  return map;
}

// ── Skills ─────────────────────────────────────────────────────────────────

interface LocalSkill {
  id: string;
  domain: string;
  name: string;
  version: string;
  status: string;
  tools: unknown[];
}

async function getLocalSkills(token: string): Promise<LocalSkill[]> {
  const res = await fetch(`${API_URL}/skills`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; data?: LocalSkill[] };
  if (!json.ok) throw new Error('Failed to list skills from api-gateway');
  const skills = (json.data ?? []).filter((s) => s.status === 'PUBLISHED');
  if (DOMAIN_FILTER) return skills.filter((s) => s.domain.startsWith(DOMAIN_FILTER));
  return skills;
}

async function pushSkill(skillId: string, token: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/skills/${skillId}/publish-to-registry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return res.ok;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║      BEX Skill Registry Push                 ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  API:     ${API_URL}`);
  console.log(`  Filter:  ${DOMAIN_FILTER || '(all published skills)'}`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  const token = await getAuthToken();
  console.log('🔑 Authenticated\n');

  const [registryMap, localSkills] = await Promise.all([
    getRegistrySkills(token),
    getLocalSkills(token),
  ]);

  console.log(`📡 Registry has ${registryMap.size} skill(s)`);
  console.log(`📦 Local has ${localSkills.length} PUBLISHED skill(s) to evaluate\n`);

  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (const skill of localSkills.sort((a, b) => a.domain.localeCompare(b.domain))) {
    const inRegistry = registryMap.has(skill.domain);
    const registryVersion = registryMap.get(skill.domain);
    const needsPush = !inRegistry || registryVersion !== skill.version;

    const label = !inRegistry ? '🆕 NEW   ' : needsPush ? '🔄 UPDATE' : '✅ SYNCED';
    const toolCount = Array.isArray(skill.tools) ? skill.tools.length : '?';
    console.log(`  ${label}  ${skill.domain.padEnd(48)} v${skill.version}  (${toolCount} tools)`);

    if (!needsPush) { skipped++; continue; }
    if (DRY_RUN)    { pushed++;  continue; }

    const ok = await pushSkill(skill.id, token);
    if (ok) {
      pushed++;
    } else {
      console.log(`           ❌ Push failed for ${skill.domain}`);
      failed++;
    }
  }

  console.log('\n══════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(`  DRY RUN — would push: ${pushed}  |  already synced: ${skipped}`);
  } else {
    console.log(`  Pushed: ${pushed}  |  Already synced: ${skipped}  |  Failed: ${failed}`);
  }
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
