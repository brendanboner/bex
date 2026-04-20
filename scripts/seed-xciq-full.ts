/**
 * seed-xciq-full.ts
 *
 * Generates the complete ExtremeCloud IQ skill set from the OpenAPI spec,
 * stores skills in the DB, links them to a monitoring agent, and pushes to the
 * local skill registry.
 *
 * Usage: npx tsx scripts/seed-xciq-full.ts
 *
 * Credentials (in priority order):
 *   1. XCIQ_USERNAME + XCIQ_PASSWORD env vars
 *   2. Any existing USERNAME_PASSWORD credential in the DB whose name contains "xiq" or "extremecloudiq"
 *   3. Any existing USERNAME_PASSWORD credential in the DB
 *
 * Set env vars to avoid interactive prompts:
 *   XCIQ_USERNAME=you@company.com XCIQ_PASSWORD=yourpass npx tsx scripts/seed-xciq-full.ts
 */
import { PrismaClient } from '@prisma/client';
import { fetch } from 'undici';
import { buildSkillsFromOpenApi } from '../packages/skill-engine/src/openapi-skill-builder.js';
import { CredentialVaultService } from '../packages/credential-vault/src/service.js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env if present
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) config({ path: envPath });

const prisma = new PrismaClient();
const vault = new CredentialVaultService(prisma);

const XCIQ_SPEC_URL   = 'https://api.extremecloudiq.com/openapi';
const XCIQ_BASE_URL   = 'https://api.extremecloudiq.com';
const XCIQ_LOGIN_URL  = 'https://api.extremecloudiq.com/login';
const DOMAIN_PREFIX   = 'extremecloudiq';
const REGISTRY_URL    = process.env['SKILL_REGISTRY_URL'] ?? 'http://localhost:5050';
const REGISTRY_TOKEN  = process.env['SKILL_REGISTRY_TOKEN'] ?? 'bex-registry-dev';
const TG_BOT_TOKEN    = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
const TG_CHAT_ID      = process.env['TELEGRAM_APPROVAL_CHAT_ID'] ?? '';

// Credentials from env (preferred) or discovered from DB
const XCIQ_USERNAME   = process.env['XCIQ_USERNAME'] ?? '';
const XCIQ_PASSWORD   = process.env['XCIQ_PASSWORD'] ?? '';

// Tags to consolidate into fewer meaningful skills instead of one-per-tag
const TAG_GROUPS: Record<string, string[]> = {
  'devices':            ['Device'],
  'clients':            ['Client', 'Client - Details'],
  'network.policy':     ['Configuration - Policy', 'Network Policy'],
  'network.config':     ['Configuration - Basic', 'Configuration - Network', 'Configuration - Deployment'],
  'network.auth':       ['Configuration - Authentication', 'Configuration - Certificate', 'Configuration - User Management'],
  'alerts.logs':        ['Alert', 'Log', 'Notification'],
  'monitoring':         ['Dashboard', 'Dashboard Wired Client Health', 'Dashboard Wired Device Health',
                         'Dashboard Wireless Client Health', 'Dashboard Wireless Device Health',
                         'Dashboard Wireless Usage and Capacity', 'Dashboard Wired Usage and Capacity',
                         'Network Scorecard', 'Copilot - Anomalies', 'Copilot - Connectivity Experience'],
  'location':           ['Location', 'Geo View'],
  'account.admin':      ['Account', 'User', 'Administration', 'Authorization'],
  'reports':            ['NG Reports (Ondemand)', 'NG Reports (Scheduled)'],
};

async function sendTelegram(text: string): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text }),
    });
  } catch { /* non-fatal */ }
}

async function pushToRegistry(skill: { domain: string; name: string; version: string; [k: string]: unknown }): Promise<boolean> {
  try {
    const res = await fetch(`${REGISTRY_URL}/registry/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${REGISTRY_TOKEN}`,
      },
      body: JSON.stringify(skill),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔧 ExtremeCloud IQ Full Skill Builder\n');

  await sendTelegram('🔧 Forge: Building complete ExtremeCloud IQ skill set from OpenAPI spec...');

  // ── 1. Fetch OpenAPI spec ─────────────────────────────────────────────────
  console.log('📥 Fetching OpenAPI spec from', XCIQ_SPEC_URL);
  const specRes = await fetch(XCIQ_SPEC_URL);
  const spec = await specRes.json() as Record<string, unknown>;
  const allTags = Object.keys(spec.paths ? Object.values(spec.paths as Record<string, unknown>)
    .flatMap(m => Object.values(m as Record<string, unknown>))
    .flatMap((op: any) => op.tags ?? [])
    .reduce((acc: Record<string, boolean>, t: string) => { acc[t] = true; return acc; }, {}) : {});

  console.log(`  Found ${Object.keys((spec.paths ?? {}) as Record<string, unknown>).length} paths`);

  // ── 2. Resolve the XCIQ credential ───────────────────────────────────────
  let credentialId: string;

  if (XCIQ_USERNAME && XCIQ_PASSWORD) {
    // Env vars provided — upsert a credential
    const credName = `ExtremeCloud IQ (${XCIQ_USERNAME})`;
    const existingCred = await prisma.credential.findFirst({
      where: { name: credName },
      select: { id: true },
    });
    if (existingCred) {
      credentialId = existingCred.id;
      console.log(`✔ Using existing credential: ${credentialId}`);
    } else {
      const cred = await vault.create({
        name: credName,
        description: `ExtremeCloud IQ credentials for ${XCIQ_USERNAME}`,
        scope: 'SYSTEM',
        credentialType: 'USERNAME_PASSWORD',
        value: { username: XCIQ_USERNAME, password: XCIQ_PASSWORD },
        allowedAgentPermissions: ['xciq:read', 'xciq:write', '*'],
      });
      credentialId = cred.id;
      console.log(`✔ Created credential: ${credentialId}`);
    }
  } else {
    // No env vars — try to find any XIQ-related credential already in DB
    const existingCred = await prisma.credential.findFirst({
      where: {
        credentialType: 'USERNAME_PASSWORD',
        OR: [
          { name: { contains: 'xiq', mode: 'insensitive' } },
          { name: { contains: 'extremecloudiq', mode: 'insensitive' } },
          { name: { contains: 'ExtremeCloud IQ', mode: 'insensitive' } },
          { description: { contains: 'extremecloudiq.com', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    });
    if (existingCred) {
      credentialId = existingCred.id;
      console.log(`✔ Using existing credential "${existingCred.name}": ${credentialId}`);
    } else {
      console.error('❌ No XIQ credential found.\n');
      console.error('   Either set env vars:  XCIQ_USERNAME=you@company.com XCIQ_PASSWORD=yourpass');
      console.error('   Or add a credential in the dashboard (Vault → New Credential, type: USERNAME_PASSWORD,');
      console.error('   name containing "XIQ" or "ExtremeCloud IQ") before running this script.');
      process.exit(1);
    }
  }

  // ── 3. Get system owner ───────────────────────────────────────────────────
  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) throw new Error('No users found — run bex init first');

  // ── 4. Create/update the main monitoring agent ────────────────────────────
  let agentId: string;
  const existingAgent = await prisma.agent.findFirst({
    where: { name: 'ExtremeCloud IQ Monitor' },
    select: { id: true, charterId: true },
  });

  const agentPayload = {
    name: 'ExtremeCloud IQ Monitor',
    description: 'Full-featured ExtremeCloud IQ agent: manage devices, clients, VLANs, SSIDs, policies, and more.',
    llmProvider: 'openai' as const,
    llmModel: 'gpt-4o',
    permissions: ['xciq:read', 'xciq:write', '*'],
    persona: {
      systemPrompt: `You are a comprehensive ExtremeCloud IQ network assistant with full API access.

You can: list and manage devices, view/disconnect clients, create/update VLANs and SSIDs,
configure network policies, manage users, view alerts and logs, generate reports, and more.

IMPORTANT: For any write operation (create, update, delete, push config), always:
1. Describe exactly what will change
2. Ask for explicit confirmation before proceeding
3. Report the outcome clearly

Format responses concisely for Telegram. Use plain text with dashes/numbers for lists.`,
    },
    ownerId: owner.id,
  };

  if (existingAgent) {
    await prisma.agent.update({ where: { id: existingAgent.id }, data: agentPayload });
    agentId = existingAgent.id;
    console.log(`✔ Updated agent: ${agentId}`);
  } else {
    const agent = await prisma.agent.create({ data: agentPayload });
    agentId = agent.id;
    console.log(`✔ Created agent: ${agentId}`);
  }

  // Set charter with mixed posture — SUPERVISED for write ops
  const charterData = {
    mandate: 'Manage and monitor ExtremeCloud IQ. Read operations are autonomous. Write operations (creating/modifying/deleting config) require human approval.',
    posture: 'SUPERVISED' as const,
    conductBoundaries: ['delete:*', 'push:config'],
    escalationTriggers: ['bulk delete', 'fabric reset', 'password change'],
  };

  let charterId: string;
  if (existingAgent?.charterId) {
    await prisma.agentCharter.update({ where: { id: existingAgent.charterId }, data: charterData });
    charterId = existingAgent.charterId;
  } else {
    const charter = await prisma.agentCharter.create({ data: charterData });
    charterId = charter.id;
  }
  await prisma.agent.update({ where: { id: agentId }, data: { charterId } });
  console.log(`✔ Charter (SUPERVISED for writes): ${charterId}`);

  // ── 5. Generate skill groups from OpenAPI ─────────────────────────────────
  console.log('\n📐 Generating skills from OpenAPI spec...\n');

  const allSkillIds: string[] = [];
  let totalTools = 0;
  let pushedToRegistry = 0;

  for (const [groupDomain, tags] of Object.entries(TAG_GROUPS)) {
    // Build skills for this tag group
    const skills = await buildSkillsFromOpenApi({
      specUrl: XCIQ_SPEC_URL,
      baseUrl: XCIQ_BASE_URL,
      loginUrl: XCIQ_LOGIN_URL,
      handlerType: 'xciq_http_call',
      domainPrefix: DOMAIN_PREFIX,
      includeTags: tags,
      maxToolsPerSkill: 35,
      spec,
    });

    // Merge all parts into one skill per group (rename domain to group)
    const mergedTools = skills.flatMap(s => s.tools);
    const hasWrites = mergedTools.some(t => t.config.isWrite);
    const readCount = mergedTools.filter(t => !t.config.isWrite).length;
    const writeCount = mergedTools.filter(t => t.config.isWrite).length;

    const groupName = tags.join(' / ');
    const domain = `${DOMAIN_PREFIX}.${groupDomain}`;

    const skillRecord = {
      name: `ExtremeCloud IQ — ${groupName}`,
      domain,
      description: `ExtremeCloud IQ API: ${groupName}. ${readCount} read ops, ${writeCount} write ops.`,
      version: '1.0.0',
      capabilities: mergedTools
        .slice(0, 10)
        .map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', ''))
        .filter(Boolean),
      systemPrompt: `You manage ExtremeCloud IQ: ${groupName}.

READ ops (${readCount}): Execute freely.
WRITE ops (${writeCount}): ${writeCount > 0 ? 'Always describe the change and get explicit user confirmation before POST/PUT/PATCH/DELETE.' : 'None.'}`,
      tools: mergedTools,
    };

    // Upsert in DB
    const existing = await prisma.skill.findFirst({ where: { domain }, select: { id: true } });
    let skillId: string;
    if (existing) {
      await prisma.skill.update({
        where: { id: existing.id },
        data: { name: skillRecord.name, description: skillRecord.description, version: skillRecord.version, capabilities: skillRecord.capabilities, systemPrompt: skillRecord.systemPrompt, tools: skillRecord.tools as any },
      });
      skillId = existing.id;
    } else {
      const created = await prisma.skill.create({ data: skillRecord as any });
      skillId = created.id;
    }
    allSkillIds.push(skillId);
    totalTools += mergedTools.length;

    // Link to agent
    const existingLink = await prisma.agentSkill.findFirst({ where: { agentId, skillId } });
    if (!existingLink) await prisma.agentSkill.create({ data: { agentId, skillId } });

    // Push to registry
    const pushed = await pushToRegistry({ ...skillRecord, id: skillId });
    if (pushed) pushedToRegistry++;

    const icon = hasWrites ? '✏️' : '📖';
    console.log(`  ${icon} [${domain}] ${mergedTools.length} tools (${readCount}R/${writeCount}W) — DB: ${skillId.slice(-8)} Registry: ${pushed ? '✅' : '⚠️'}`);
  }

  // Update credential permissions to include wildcard for new agent
  await prisma.credential.update({
    where: { id: credentialId },
    data: { allowedAgentPermissions: ['xciq:read', 'xciq:write', '*'] },
  });

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  Skills created: ${allSkillIds.length}`);
  console.log(`  Total tools:    ${totalTools}`);
  console.log(`  Pushed to registry: ${pushedToRegistry}/${allSkillIds.length}`);
  console.log(`  Agent ID:       ${agentId}`);
  console.log(`  Credential ID:  ${credentialId}`);
  console.log(`══════════════════════════════════════════════════\n`);

  // ── 6. Notify Telegram ─────────────────────────────────────────────────────
  const summary = `✅ ExtremeCloud IQ full skill set ready!

${allSkillIds.length} skills | ${totalTools} tools | ${pushedToRegistry} in registry

Skills cover:
- Devices (list, configure, push, reboot)
- Clients (list, details, disconnect, monitor)  
- Network Policy (SSIDs, VLANs, user profiles)
- Config (auth, certs, deployment)
- Alerts, Logs, Notifications
- Monitoring dashboards & Copilot
- Location, Reports, Admin

Write operations require your approval before executing.

Try: "List all devices" or "Show alerts" or "Create a VLAN"`;

  await sendTelegram(summary);
  console.log('📱 Telegram notification sent');
  console.log('\nDone! Update TELEGRAM_DEFAULT_AGENT_ID to', agentId, 'to use via Telegram.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
