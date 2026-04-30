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
const XIQ_USERNAME    = process.env['XIQ_USERNAME'] ?? process.env['XCIQ_USERNAME'] ?? '';
const XIQ_PASSWORD    = process.env['XIQ_PASSWORD'] ?? process.env['XCIQ_PASSWORD'] ?? '';

// LLM config — use caller's provider so agents match the rest of the platform
const llmProviderRaw  = process.env['LLM_PROVIDER'] ?? 'openai';
const LLM_PROVIDER    = (llmProviderRaw === 'azure' ? 'azure-openai' : llmProviderRaw) as 'openai' | 'anthropic' | 'azure-openai' | 'ollama';
const LLM_MODEL       = process.env['LLM_MODEL'] ?? 'gpt-4o';

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
  'wireless':           ['Radio Profile', 'Channel Plan', 'Radio'],
  'topology':           ['Client Trail', 'Topology'],
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

  // ── 2. Resolve the XIQ credential ────────────────────────────────────────
  let credentialId: string;

  if (XIQ_USERNAME && XIQ_PASSWORD) {
    // Env vars provided — upsert a credential
    const credName = `ExtremeCloud IQ (${XIQ_USERNAME})`;
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
        description: `ExtremeCloud IQ credentials for ${XIQ_USERNAME}`,
        scope: 'SYSTEM',
        credentialType: 'USERNAME_PASSWORD',
        value: { username: XIQ_USERNAME, password: XIQ_PASSWORD },
        allowedAgentPermissions: ['xiq:read', 'xiq:write', '*'],
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
      console.error('   Either set env vars:  XIQ_USERNAME=you@company.com XIQ_PASSWORD=yourpass');
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
    llmProvider: LLM_PROVIDER,
    llmModel: LLM_MODEL,
    permissions: ['xiq:read', 'xiq:write', '*'],
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
      handlerType: 'xiq_http_call',
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

  // ── 5b. Composite skill ───────────────────────────────────────────────────
  console.log('🧩 Creating composite intelligence skill...\n');

  const compositeTools = [
    {
      name: 'xiq_clients_by_vendor',
      description: 'List all active clients filtered by vendor/OS (apple/android/windows). Handles OUI, hostname, and os_type detection automatically. Returns hostname, IP, VLAN, SSID, AP name, signal quality per client.',
      handlerType: 'xiq_clients_by_vendor',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_clients_by_vendor' },
      parameters: {
        type: 'object' as const,
        properties: {
          vendor: { type: 'string', description: 'Vendor filter: "apple", "android", or "windows". Default: "apple"' },
          apName: { type: 'string', description: 'Optional: filter to clients connected to APs whose name contains this string' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'xiq_radio_quality_by_ap',
      description: 'Get radio quality metrics (SNR, RSSI, noise floor, TX/RX rates) for all APs. Automatically lists devices first and passes deviceIds to the radio-information endpoint. Returns per-AP, per-radio breakdown.',
      handlerType: 'xiq_radio_quality_report',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_radio_quality_by_ap' },
      parameters: {
        type: 'object' as const,
        properties: {
          apNameFilter: { type: 'string', description: 'Optional: only include APs whose hostname contains this string' },
          radioType: { type: 'string', description: 'Optional: filter by radio type — "2.4GHz", "5GHz", or "6GHz"' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'xiq_topology_report',
      description: 'Full SSID→VLAN→Client correlation map. Returns each SSID with its assigned VLAN, network policy, and list of currently connected clients. Use for SSID/VLAN audit and network topology queries.',
      handlerType: 'xiq_topology_report',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_topology_report' },
      parameters: {
        type: 'object' as const,
        properties: {
          ssidFilter: { type: 'string', description: 'Optional: only include SSIDs whose name contains this string' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'xiq_client_snapshot',
      description: 'Full status snapshot for a specific client device — current connection, AP, SSID, IP, signal quality, VLAN, and recent events. Handles MAC randomisation and partial hostname matching.',
      handlerType: 'xiq_client_snapshot',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_client_snapshot' },
      parameters: {
        type: 'object' as const,
        properties: {
          clientName: { type: 'string', description: 'Hostname or partial name of the client device (e.g. "John-iPhone", "MacBook-Pro")' },
          macAddress: { type: 'string', description: 'MAC address of the client (alternative to clientName)' },
          lookbackHours: { type: 'number', description: 'Hours of history to search for disconnected clients (default: 24)' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'xiq_client_health_report',
      description: 'Client health report for all active wireless clients — returns signal quality, retry rate, TX/RX throughput, roaming history, and health classification (good/fair/poor). Use for "show all clients with poor connectivity" queries.',
      handlerType: 'xiq_client_health_report',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_client_health_report' },
      parameters: {
        type: 'object' as const,
        properties: {
          healthFilter: { type: 'string', description: 'Optional: filter by health: "poor", "fair", or "good"' },
          apFilter: { type: 'string', description: 'Optional: only clients connected to APs matching this name' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'xiq_policy_sankey',
      description: 'Build a Mermaid sankey-beta diagram showing the flow Policies → SSIDs → Access Points → Client counts. Returns sankey_diagram (Mermaid string), flows array, and summary counts. Use for "show policy/SSID/AP client distribution" or any Sankey/flow visualisation request.',
      handlerType: 'xiq_policy_sankey',
      config: { loginUrl: XCIQ_LOGIN_URL, isWrite: false, operationId: 'xiq_policy_sankey' },
      parameters: {
        type: 'object' as const,
        properties: {
          policyFilter: { type: 'string', description: 'Optional: only include policies whose name contains this string' },
        },
        required: [] as string[],
      },
    },
  ];

  const compositeDomain = 'extremecloudiq.composite';
  const compositeSkillRecord = {
    name: 'ExtremeCloud IQ — Composite Intelligence Tools',
    domain: compositeDomain,
    version: '1.0.0',
    description: 'Multi-step composite tools that handle API chaining automatically. Use these for vendor queries, radio quality, topology, and client snapshots.',
    capabilities: compositeTools.map(t => t.description.slice(0, 80)),
    systemPrompt: `You have access to pre-built composite tools that handle complex multi-step XIQ queries automatically.

ALWAYS prefer composite tools over raw API calls when they cover the query:
- Apple/Android/Windows clients → xiq_clients_by_vendor
- Radio quality, SNR, signal → xiq_radio_quality_by_ap  
- SSID/VLAN topology → xiq_topology_report
- Single device status → xiq_client_snapshot
- All clients health → xiq_client_health_report
- Policy/SSID/AP/Client flow diagram → xiq_policy_sankey

These tools handle all required API chaining (e.g., getting device IDs before radio-information) automatically.

OUTPUT FORMAT FOR DIAGRAMS: When xiq_policy_sankey returns a result, the "sankey_diagram" field contains valid Mermaid sankey-beta syntax. Return this field as-is in your response JSON so the dashboard can render it as a Mermaid widget.`,
    tools: compositeTools,
  };

  const existingComposite = await prisma.skill.findFirst({ where: { domain: compositeDomain }, select: { id: true } });
  let compositeSkillId: string;
  if (existingComposite) {
    await prisma.skill.update({
      where: { id: existingComposite.id },
      data: {
        name: compositeSkillRecord.name,
        description: compositeSkillRecord.description,
        version: compositeSkillRecord.version,
        capabilities: compositeSkillRecord.capabilities,
        systemPrompt: compositeSkillRecord.systemPrompt,
        tools: compositeSkillRecord.tools as any,
      },
    });
    compositeSkillId = existingComposite.id;
  } else {
    const created = await prisma.skill.create({ data: compositeSkillRecord as any });
    compositeSkillId = created.id;
  }
  allSkillIds.push(compositeSkillId);
  totalTools += compositeTools.length;

  const existingCompositeLink = await prisma.agentSkill.findFirst({ where: { agentId, skillId: compositeSkillId } });
  if (!existingCompositeLink) await prisma.agentSkill.create({ data: { agentId, skillId: compositeSkillId } });

  const compositePushed = await pushToRegistry({ ...compositeSkillRecord, id: compositeSkillId });
  if (compositePushed) pushedToRegistry++;

  console.log(`  🧩 [${compositeDomain}] ${compositeTools.length} tools — DB: ${compositeSkillId.slice(-8)} Registry: ${compositePushed ? '✅' : '⚠️'}`);

  // ── 5c. Seed learnedNotes for key skills ──────────────────────────────────
  console.log('\n📝 Seeding learnedNotes for key skills...');
  try {
    const learnedNotesMap: Record<string, string> = {
      'extremecloudiq.devices':
        'Radio information endpoint (/devices/radio-information) requires deviceIds[] (integer array). ALWAYS call list_devices first to get numeric IDs. NEVER call radio-information without deviceIds — it returns 400 BAD_REQUEST. Use the xiq_radio_quality_by_ap composite tool instead which handles this automatically.',
      'extremecloudiq.clients':
        'searchString does NOT filter by vendor or manufacturer. For Apple/Android/Windows clients use the xiq_clients_by_vendor composite tool. For individual device lookup use xiq_client_snapshot. Do NOT use list_active_clients + filter manually when composite tools are available.',
      'extremecloudiq.network.policy':
        'VLAN resolution requires chain: GET /network-policies → GET /network-policies/{id}/ssids → GET /user-profiles/{up_id} → GET /network/vlan-profiles. Use xiq_topology_report to get full SSID→VLAN mapping. Do NOT guess VLAN IDs.',
      'extremecloudiq.composite':
        'These are pre-built intelligence tools. Use xiq_radio_quality_by_ap for all radio/signal/SNR queries. Use xiq_clients_by_vendor for vendor filtering. Use xiq_topology_report for SSID/VLAN correlation. Use xiq_client_snapshot for single device troubleshooting. Use xiq_policy_sankey for any Sankey/flow chart of Policies→SSIDs→APs→Clients — it returns "sankey_diagram" (Mermaid sankey-beta string) which the dashboard renders as a mermaid widget.',
    };

    for (const [domain, note] of Object.entries(learnedNotesMap)) {
      const skill = await prisma.skill.findFirst({ where: { domain }, select: { id: true } });
      if (skill) {
        await prisma.skill.update({ where: { id: skill.id }, data: { learnedNotes: note } });
        console.log(`  📝 learnedNotes set for [${domain}]`);
      } else {
        console.log(`  ⚠️  Skill [${domain}] not found — skipping learnedNotes`);
      }
    }
  } catch (e) {
    console.warn('  ⚠️  learnedNotes seeding failed (non-fatal):', (e as Error).message);
  }

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
- Wireless (Radio Profiles, Channel Plans)
- Topology (Client Trail, Topology views)
- 🧩 Composite tools: vendor queries, radio quality, SSID/VLAN topology, client snapshots

Write operations require your approval before executing.

Try: "List all Apple clients" or "Show radio quality" or "SSID to VLAN map"`;

  await sendTelegram(summary);
  console.log('📱 Telegram notification sent');
  console.log('\nDone! Update TELEGRAM_DEFAULT_AGENT_ID to', agentId, 'to use via Telegram.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
