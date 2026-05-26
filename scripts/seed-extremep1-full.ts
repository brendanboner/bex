/**
 * seed-extremep1-full.ts
 *
 * Builds the complete Extreme Platform One skill set: devices, clients, sites,
 * alerts, monitoring, topology, configuration, IAM, audit, assets, notifications,
 * tagging, SD-WAN, and composite intelligence tools.
 *
 * Usage:  npx tsx scripts/seed-extremep1-full.ts
 *
 * Credentials:
 *   Set EXTREMEP1_API_TOKEN env var, or ensure system.extremep1_api_token is in the vault.
 *   Example: EXTREMEP1_API_TOKEN=extr_sk_v1.xxx npx tsx scripts/seed-extremep1-full.ts
 */
import { PrismaClient } from '@prisma/client';
import { fetch } from 'undici';
import { CredentialVaultService } from '../packages/credential-vault/src/service.js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env if present
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) config({ path: envPath });

const prisma = new PrismaClient();
const vault = new CredentialVaultService(prisma);

// ── Base URLs ──────────────────────────────────────────────────────────────────
const P1_XIQ_BASE   = 'https://cloudapi.extremecloudiq.com/xiq/v1';
const P1_SITE_BASE  = 'https://cloudapi.extremecloudiq.com/site/v1';
const P1_ALERT_BASE = 'https://cloudapi.extremecloudiq.com/alert/v1';
const P1_NVO_BASE   = 'https://cloudapi.extremecloudiq.com/nvo/v1';
const P1_PM_BASE    = 'https://cloudapi.extremecloudiq.com/pm/v1';
const P1_IAM_BASE   = 'https://cloudapi.extremecloudiq.com/iam/v1';
const P1_DLCS_BASE  = 'https://cloudapi.extremecloudiq.com/device-lifecycle';
const P1_PCS_BASE   = 'https://cloudapi.extremecloudiq.com/client/v1';
const P1_ASSET_BASE = 'https://cloudapi.extremecloudiq.com/assets/v1';
const P1_AUDIT_BASE = 'https://cloudapi.extremecloudiq.com/auditlog/v1';
const P1_META_BASE  = 'https://cloudapi.extremecloudiq.com/metastore/v1';
const P1_NOTIF_BASE = 'https://cloudapi.extremecloudiq.com/notification/v1';
const P1_TAG_BASE   = 'https://cloudapi.extremecloudiq.com/tagging/v1';
const P1_SDWAN_BASE = 'https://cloudapi.extremecloudiq.com/sdwan';

const DOMAIN_PREFIX  = 'extremep1';
const REGISTRY_URL   = process.env['SKILL_REGISTRY_URL'] ?? 'http://localhost:5050';
const REGISTRY_TOKEN = process.env['SKILL_REGISTRY_TOKEN'] ?? 'bex-registry-dev';
const TG_BOT_TOKEN   = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
const TG_CHAT_ID     = process.env['TELEGRAM_APPROVAL_CHAT_ID'] ?? '';

const P1_API_TOKEN   = process.env['EXTREMEP1_API_TOKEN'] ?? process.env['P1_API_TOKEN'] ?? '';

const llmProviderRaw = process.env['LLM_PROVIDER'] ?? 'openai';
const LLM_PROVIDER   = (llmProviderRaw === 'azure' ? 'azure-openai' : llmProviderRaw) as 'openai' | 'anthropic' | 'azure-openai' | 'ollama';
const LLM_MODEL      = process.env['LLM_MODEL'] ?? 'gpt-4o';

// ── Tool helper ────────────────────────────────────────────────────────────────
function makeP1Tool(
  name: string,
  description: string,
  method: string,
  urlPath: string,
  params: Record<string, { type: string; description: string }> = {},
  isWrite = false,
  baseUrl = P1_XIQ_BASE,
) {
  return {
    name,
    description: `[${method}] ${description}${isWrite ? ' ⚠️ WRITE OPERATION — requires approval' : ''}`,
    handlerType: 'p1_http_call',
    config: { method, urlTemplate: `${baseUrl}${urlPath}`, isWrite, operationId: name },
    parameters: { type: 'object' as const, properties: params, required: [] as string[] },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
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

async function upsertSkill(
  agentId: string,
  record: {
    name: string;
    domain: string;
    description: string;
    version: string;
    capabilities: string[];
    systemPrompt: string;
    tools: unknown[];
  },
): Promise<{ skillId: string; pushed: boolean }> {
  const existing = await prisma.skill.findFirst({ where: { domain: record.domain }, select: { id: true } });
  let skillId: string;
  if (existing) {
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        name: record.name,
        description: record.description,
        version: record.version,
        capabilities: record.capabilities,
        systemPrompt: record.systemPrompt,
        tools: record.tools as any,
      },
    });
    skillId = existing.id;
  } else {
    const created = await prisma.skill.create({ data: record as any });
    skillId = created.id;
  }

  const existingLink = await prisma.agentSkill.findFirst({ where: { agentId, skillId } });
  if (!existingLink) await prisma.agentSkill.create({ data: { agentId, skillId } });

  const pushed = await pushToRegistry({ ...record, id: skillId });
  return { skillId, pushed };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔧 Extreme Platform One Full Skill Builder\n');

  await sendTelegram('🔧 Forge: Building complete Extreme Platform One skill set...');

  // ── 1. Resolve credential ──────────────────────────────────────────────────
  const { encrypt } = await import('../packages/credential-vault/src/crypto.js');
  let credentialId: string;

  const canonicalCred = await prisma.credential.findFirst({
    where: { name: 'system.extremep1_api_token' },
    select: { id: true },
  });

  if (canonicalCred) {
    credentialId = canonicalCred.id;
    const updateData: Record<string, unknown> = {
      allowedAgentPermissions: ['p1:read', 'p1:write', 'xiq:read', 'xiq:write', '*'],
    };
    if (P1_API_TOKEN) {
      const blob = encrypt({ api_token: P1_API_TOKEN });
      Object.assign(updateData, { encryptedValue: blob.encryptedValue, iv: blob.iv, authTag: blob.authTag });
      console.log(`✔ Updated system.extremep1_api_token (${credentialId}) with new token`);
    } else {
      console.log(`✔ Patching allowedAgentPermissions on existing system.extremep1_api_token: ${credentialId}`);
    }
    await prisma.credential.update({ where: { id: credentialId }, data: updateData });
  } else if (P1_API_TOKEN) {
    const cred = await vault.create({
      name: 'system.extremep1_api_token',
      description: 'Extreme Platform One API token (canonical)',
      scope: 'SYSTEM',
      credentialType: 'API_TOKEN',
      value: { api_token: P1_API_TOKEN },
      allowedAgentPermissions: ['p1:read', 'p1:write', 'xiq:read', 'xiq:write', '*'],
    });
    credentialId = cred.id;
    console.log(`✔ Created system.extremep1_api_token: ${credentialId}`);
  } else {
    console.error('❌ No system.extremep1_api_token found and no env var provided.\n');
    console.error('   Set:  EXTREMEP1_API_TOKEN=extr_sk_v1.xxx  then re-run.');
    process.exit(1);
  }

  // ── 2. Get system owner ────────────────────────────────────────────────────
  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) throw new Error('No users found — run bex init first');

  // ── 3. Create / update agent ───────────────────────────────────────────────
  const existingAgent = await prisma.agent.findFirst({
    where: { name: 'Extreme Platform One' },
    select: { id: true, charterId: true },
  });

  const agentPayload = {
    name: 'Extreme Platform One',
    description: 'Manages and monitors your Extreme Platform One network — devices, clients, sites, alerts, policies, topology, and more using the Platform One API.',
    llmProvider: LLM_PROVIDER,
    llmModel: LLM_MODEL,
    permissions: ['p1:read', 'p1:write', 'xiq:read', 'xiq:write', '*'],
    persona: {
      systemPrompt: `You are a comprehensive Extreme Platform One network assistant with full API access.

You can: list and manage devices, view/disconnect clients, manage sites and locations, view alerts,
configure network policies, manage users, view topology, generate analytics, and more.

IMPORTANT: For any write operation (create, update, delete, push config, reboot, firmware upgrade), always:
1. Describe exactly what will change
2. Ask for explicit confirmation before proceeding
3. Report the outcome clearly

Format responses concisely for Telegram. Use plain text with dashes/numbers for lists.`,
    },
    ownerId: owner.id,
  };

  let agentId: string;
  if (existingAgent) {
    await prisma.agent.update({ where: { id: existingAgent.id }, data: agentPayload });
    agentId = existingAgent.id;
    console.log(`✔ Updated agent: ${agentId}`);
  } else {
    const agent = await prisma.agent.create({ data: agentPayload });
    agentId = agent.id;
    console.log(`✔ Created agent: ${agentId}`);
  }

  const charterData = {
    mandate: 'Monitor and manage Extreme Platform One. Read operations are autonomous. Write operations (config changes, device commands, policy deployments) require human approval.',
    posture: 'SUPERVISED' as const,
    conductBoundaries: ['delete:*', 'push:config', 'reboot:device', 'firmware:upgrade'],
    escalationTriggers: ['bulk delete', 'firmware upgrade', 'policy push', 'device reboot'],
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

  // ── 4. Build skill domains ─────────────────────────────────────────────────
  console.log('\n📐 Creating Platform One skill domains...\n');

  const allSkillIds: string[] = [];
  let totalTools = 0;
  let pushedToRegistry = 0;

  // ────────────────────────────────────────────────────────────────────────────
  // 4a. extremep1.devices — Device Management
  // ────────────────────────────────────────────────────────────────────────────
  const deviceTools = [
    makeP1Tool('p1_list_devices', 'List all network devices (APs, switches). views: FULL, CLIENT_STATS, LOCATION, NETWORK_POLICY, RADIO', 'GET', '/devices', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, connected: { type: 'boolean', description: 'Filter by connection status' }, views: { type: 'string', description: 'View type: FULL, CLIENT_STATS, LOCATION, NETWORK_POLICY, RADIO' } }),
    makeP1Tool('p1_get_device', 'Get details for a specific device by ID', 'GET', '/devices/{id}', { id: { type: 'number', description: 'Device ID' } }),
    makeP1Tool('p1_get_device_stats', 'Get real-time stats for a device', 'GET', '/devices/{id}/stats', { id: { type: 'number', description: 'Device ID' } }),
    makeP1Tool('p1_get_devices_radio_info', 'Get radio information for devices (deviceIds is comma-separated integer list)', 'GET', '/devices/radio-information', { deviceIds: { type: 'string', description: 'Comma-separated integer device IDs (e.g. "1001,1002,1003"). Always call p1_list_devices first to get numeric IDs.' } }),
    makeP1Tool('p1_reboot_device', 'Reboot one or more devices', 'POST', '/devices/:reboot', { deviceIds: { type: 'string', description: 'JSON array of device IDs to reboot' } }, true),
    makeP1Tool('p1_get_device_firmware_upgrade_status', 'Get firmware upgrade status for a device', 'GET', '/devices/{id}/firmware', { id: { type: 'number', description: 'Device ID' } }),
    makeP1Tool('p1_upgrade_device_firmware', 'Upgrade firmware on devices', 'POST', '/devices/:firmware', { deviceIds: { type: 'string', description: 'JSON array of device IDs' }, firmwareVersion: { type: 'string', description: 'Target firmware version' } }, true),
    makeP1Tool('p1_list_devices_dlcs', 'Fetch device inventory from asset service (DLCS)', 'POST', '/devices/fetch', { page: { type: 'number', description: 'Page number (default: 1)' }, pageSize: { type: 'number', description: 'Results per page (default: 100)' } }, false, P1_DLCS_BASE),
    makeP1Tool('p1_get_device_by_serial', 'Get device by serial number', 'GET', '/devices/serial/{serialNumber}', { serialNumber: { type: 'string', description: 'Device serial number' } }, false, P1_DLCS_BASE),
    makeP1Tool('p1_get_device_by_mac', 'Get device by MAC address', 'GET', '/devices/mac/{macAddress}', { macAddress: { type: 'string', description: 'Device MAC address' } }, false, P1_DLCS_BASE),
    makeP1Tool('p1_assign_device_location', 'Assign device to a location', 'PUT', '/devices/{id}/location', { id: { type: 'number', description: 'Device ID' }, locationId: { type: 'number', description: 'Location ID to assign device to' } }, true),
    makeP1Tool('p1_enable_device', 'Enable devices', 'POST', '/devices/:enable', { deviceIds: { type: 'string', description: 'JSON array of device IDs to enable' } }, true),
    makeP1Tool('p1_disable_device', 'Disable devices', 'POST', '/devices/:disable', { deviceIds: { type: 'string', description: 'JSON array of device IDs to disable' } }, true),
    makeP1Tool('p1_get_firmware_summary', 'Get firmware version summary across all devices', 'GET', '/devices/firmware-summary', {}, false, P1_ASSET_BASE),
  ];

  const devResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Device Management',
    domain: `${DOMAIN_PREFIX}.devices`,
    description: `Platform One device lifecycle: list, monitor, reboot, firmware upgrade, and location assignment. ${deviceTools.filter(t => !t.config.isWrite).length} read ops, ${deviceTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: deviceTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One device lifecycle. Always use p1_list_devices before p1_get_devices_radio_info (need numeric IDs). For radio info, pass deviceIds as a comma-separated list. Write ops require approval.`,
    tools: deviceTools,
  });
  allSkillIds.push(devResult.skillId);
  totalTools += deviceTools.length;
  if (devResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.devices] ${deviceTools.length} tools — DB: ${devResult.skillId.slice(-8)} Registry: ${devResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4b. extremep1.clients — Client Management
  // ────────────────────────────────────────────────────────────────────────────
  const clientTools = [
    makeP1Tool('p1_list_active_clients', 'List all currently connected wireless clients. views: BASIC, FULL, CLIENT_DETAILS, HEALTH_STATUS, CONNECTION_INFO', 'GET', '/clients/active', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, views: { type: 'string', description: 'View type: BASIC (default), FULL, CLIENT_DETAILS, HEALTH_STATUS, CONNECTION_INFO' } }),
    makeP1Tool('p1_get_client_details', 'Get detailed info for a wireless client', 'GET', '/clients/{id}/details', { id: { type: 'string', description: 'Client ID' } }),
    makeP1Tool('p1_disconnect_client', 'Disconnect a client from the network', 'POST', '/clients/:disconnect', { clientIds: { type: 'string', description: 'JSON array of client IDs to disconnect' } }, true),
    makeP1Tool('p1_get_client_usage', 'Get data usage statistics for a client', 'GET', '/clients/{id}/usage', { id: { type: 'string', description: 'Client ID' } }),
    makeP1Tool('p1_list_wireless_clients_grid', 'Query wireless clients with filters and pagination', 'POST', '/wireless-grid', { page: { type: 'number', description: 'Page number' }, pageSize: { type: 'number', description: 'Results per page' }, searchString: { type: 'string', description: 'Search by hostname (not vendor/manufacturer)' } }, false, P1_PCS_BASE),
    makeP1Tool('p1_list_wired_clients_grid', 'Query wired clients with filters and pagination', 'POST', '/wired-grid', { page: { type: 'number', description: 'Page number' }, pageSize: { type: 'number', description: 'Results per page' } }, false, P1_PCS_BASE),
    makeP1Tool('p1_get_wireless_client_p1', 'Get wireless client details by UUID', 'GET', '/wireless/{uuid}', { uuid: { type: 'string', description: 'Client UUID' } }, false, P1_PCS_BASE),
    makeP1Tool('p1_get_wired_client_p1', 'Get wired client details by UUID', 'GET', '/wired/{uuid}', { uuid: { type: 'string', description: 'Client UUID' } }, false, P1_PCS_BASE),
    makeP1Tool('p1_get_client_alias', 'Get alias/name for a client', 'GET', '/clients/{id}/alias', { id: { type: 'string', description: 'Client ID' } }),
    makeP1Tool('p1_set_client_alias', 'Set alias/name for a client', 'PUT', '/clients/{id}/alias', { id: { type: 'string', description: 'Client ID' }, alias: { type: 'string', description: 'Alias name to set' } }, true),
    makeP1Tool('p1_get_client_summary', 'Get aggregate client statistics', 'GET', '/clients/summary', {}),
    makeP1Tool('p1_get_mac_oui', 'Look up manufacturer for a MAC address OUI', 'GET', '/clients/oui/{mac}', { mac: { type: 'string', description: 'MAC address to look up OUI for' } }),
  ];

  const clientResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Client Management',
    domain: `${DOMAIN_PREFIX}.clients`,
    description: `Platform One client queries: wireless/wired clients, usage, OUI lookup. ${clientTools.filter(t => !t.config.isWrite).length} read ops, ${clientTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: clientTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One client queries. For vendor filtering (Apple/Android/Windows), use the p1_clients_by_vendor composite tool which handles OUI/hostname/os_type detection automatically. For individual client lookup, use p1_client_snapshot composite tool.`,
    tools: clientTools,
  });
  allSkillIds.push(clientResult.skillId);
  totalTools += clientTools.length;
  if (clientResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.clients] ${clientTools.length} tools — DB: ${clientResult.skillId.slice(-8)} Registry: ${clientResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4c. extremep1.sites — Site and Location Management
  // ────────────────────────────────────────────────────────────────────────────
  const siteTools = [
    makeP1Tool('p1_list_sites', 'List all sites', 'GET', '/sites', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_get_site', 'Get details for a specific site', 'GET', '/sites/{id}', { id: { type: 'string', description: 'Site ID' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_create_site', 'Create a new site', 'POST', '/sites', { name: { type: 'string', description: 'Site name' }, address: { type: 'string', description: 'Street address' }, city: { type: 'string', description: 'City' }, state: { type: 'string', description: 'State/province' }, country: { type: 'string', description: 'Country' } }, true, P1_SITE_BASE),
    makeP1Tool('p1_update_site', 'Update site details', 'PUT', '/sites/{id}', { id: { type: 'string', description: 'Site ID' } }, true, P1_SITE_BASE),
    makeP1Tool('p1_delete_site', 'Delete a site', 'DELETE', '/sites/{id}', { id: { type: 'string', description: 'Site ID' } }, true, P1_SITE_BASE),
    makeP1Tool('p1_list_buildings', 'List buildings, optionally filtered by site', 'GET', '/buildings', { siteId: { type: 'string', description: 'Filter by site ID' }, page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_get_building', 'Get building details', 'GET', '/buildings/{id}', { id: { type: 'string', description: 'Building ID' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_create_building', 'Create a new building', 'POST', '/buildings', { name: { type: 'string', description: 'Building name' }, siteId: { type: 'string', description: 'Parent site ID' } }, true, P1_SITE_BASE),
    makeP1Tool('p1_list_floors', 'List floors in a building', 'GET', '/floors', { buildingId: { type: 'string', description: 'Building ID to list floors for' }, page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_get_floor', 'Get floor details', 'GET', '/floors/{id}', { id: { type: 'string', description: 'Floor ID' } }, false, P1_SITE_BASE),
    makeP1Tool('p1_get_location_tree', 'Get the full location hierarchy tree (sites → buildings → floors)', 'GET', '/tree', {}, false, P1_SITE_BASE),
    makeP1Tool('p1_get_location_tree_devices', 'Get location tree with associated devices', 'GET', '/tree/devices', {}, false, P1_SITE_BASE),
    makeP1Tool('p1_get_location_count', 'Get count of sites, buildings, and floors', 'GET', '/count', {}, false, P1_SITE_BASE),
    makeP1Tool('p1_list_site_groups', 'List all site groups', 'GET', '/site-groups', {}, false, P1_SITE_BASE),
    makeP1Tool('p1_move_location', 'Move a location in the hierarchy', 'POST', '/locations/move', { locationId: { type: 'string', description: 'ID of the location to move' }, targetParentId: { type: 'string', description: 'ID of the target parent location' } }, true, P1_SITE_BASE),
  ];

  const siteResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Sites and Locations',
    domain: `${DOMAIN_PREFIX}.sites`,
    description: `Platform One location hierarchy: sites, buildings, floors. ${siteTools.filter(t => !t.config.isWrite).length} read ops, ${siteTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: siteTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One location/site hierarchy. Use p1_get_location_tree for an overview of all sites/buildings/floors. Site IDs from this service are used as locationId in other services (devices, monitoring, alerts).`,
    tools: siteTools,
  });
  allSkillIds.push(siteResult.skillId);
  totalTools += siteTools.length;
  if (siteResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.sites] ${siteTools.length} tools — DB: ${siteResult.skillId.slice(-8)} Registry: ${siteResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4d. extremep1.alerts — Alerts and Events
  // ────────────────────────────────────────────────────────────────────────────
  const alertTools = [
    makeP1Tool('p1_list_alerts', 'List alerts with optional filters. NEVER pass sortField or order — causes 400 BAD_REQUEST', 'GET', '/alerts', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, severities: { type: 'string', description: 'Comma-separated: CRITICAL,MAJOR,MINOR,WARNING,INFO' }, categoryIds: { type: 'string', description: 'Comma-separated category IDs' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, keyword: { type: 'string', description: 'Search keyword' }, siteId: { type: 'string', description: 'Filter by site ID' }, buildingId: { type: 'string', description: 'Filter by building ID' } }, false, P1_ALERT_BASE),
    makeP1Tool('p1_get_alert_count', 'Get alert counts grouped by category', 'GET', '/alerts/count-by-group', {}, false, P1_ALERT_BASE),
    makeP1Tool('p1_get_alert_severity_counts', 'Get alert counts by severity level (Critical/Major/Minor/Warning/Info)', 'GET', '/alerts/severity-counts', {}, false, P1_ALERT_BASE),
    makeP1Tool('p1_acknowledge_alerts', 'Acknowledge one or more alerts', 'POST', '/alerts/:acknowledge', { alertIds: { type: 'string', description: 'JSON array of alert IDs to acknowledge' } }, true, P1_ALERT_BASE),
    makeP1Tool('p1_clear_alerts', 'Clear/resolve one or more alerts', 'POST', '/alerts/:clear', { alertIds: { type: 'string', description: 'JSON array of alert IDs to clear' } }, true, P1_ALERT_BASE),
    makeP1Tool('p1_get_alert_metadata', 'Get alert metadata (categories, severities, message types)', 'GET', '/metadata', {}, false, P1_ALERT_BASE),
    makeP1Tool('p1_get_alert_categories', 'List all alert category types', 'GET', '/metadata/categories', {}, false, P1_ALERT_BASE),
    makeP1Tool('p1_list_alert_policies', 'List alert policies', 'GET', '/alert-policies', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_ALERT_BASE),
    makeP1Tool('p1_create_alert_policy', 'Create an alert policy', 'POST', '/alert-policies', { name: { type: 'string', description: 'Policy name' }, enabled: { type: 'boolean', description: 'Whether policy is enabled' }, conditions: { type: 'string', description: 'JSON array of policy conditions' } }, true, P1_ALERT_BASE),
    makeP1Tool('p1_list_events', 'List network events', 'GET', '/events', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, type: { type: 'string', description: 'Event type filter' }, severity: { type: 'string', description: 'Severity filter' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }, false, P1_META_BASE),
    makeP1Tool('p1_get_event_types', 'List available event types', 'GET', '/events/types', {}, false, P1_META_BASE),
    makeP1Tool('p1_get_event_severities', 'List event severity levels', 'GET', '/events/severities', {}, false, P1_META_BASE),
  ];

  const alertResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Alerts and Events',
    domain: `${DOMAIN_PREFIX}.alerts`,
    description: `Platform One alerts, events, and alert policies. ${alertTools.filter(t => !t.config.isWrite).length} read ops, ${alertTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: alertTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One alerts and events. NEVER pass sortField or order to p1_list_alerts — it causes 400 BAD_REQUEST. Use p1_get_alert_severity_counts for a quick overview of alert health. For acknowledging/clearing, describe the action and confirm with user first.`,
    tools: alertTools,
  });
  allSkillIds.push(alertResult.skillId);
  totalTools += alertTools.length;
  if (alertResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.alerts] ${alertTools.length} tools — DB: ${alertResult.skillId.slice(-8)} Registry: ${alertResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4e. extremep1.monitoring — Performance Monitoring and Analytics
  // ────────────────────────────────────────────────────────────────────────────
  const monitoringTools = [
    makeP1Tool('p1_get_client_health_analytics', 'Get client health analytics data', 'POST', '/analytics/client-health', { startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, locationIds: { type: 'string', description: 'JSON array of location IDs' }, granularity: { type: 'string', description: 'HOUR, DAY, or WEEK' } }, false, P1_PM_BASE),
    makeP1Tool('p1_get_client_health_stats', 'Get aggregated client health statistics', 'POST', '/analytics/client-health/stats', { startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, locationIds: { type: 'string', description: 'JSON array of location IDs' } }, false, P1_PM_BASE),
    makeP1Tool('p1_get_device_health_analytics', 'Get device health analytics', 'POST', '/analytics/device-health', { startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, locationIds: { type: 'string', description: 'JSON array of location IDs' }, granularity: { type: 'string', description: 'HOUR, DAY, or WEEK' } }, false, P1_PM_BASE),
    makeP1Tool('p1_get_usage_capacity', 'Get usage and capacity analytics', 'POST', '/analytics/usage-capacity', { startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, locationIds: { type: 'string', description: 'JSON array of location IDs' }, granularity: { type: 'string', description: 'HOUR, DAY, or WEEK' } }, false, P1_PM_BASE),
    makeP1Tool('p1_get_metric_data', 'Get specific metric data for entities', 'POST', '/metric-data', { metrics: { type: 'string', description: 'JSON array of metric names' }, entityType: { type: 'string', description: 'Entity type (e.g. AP, SWITCH)' }, entityIds: { type: 'string', description: 'JSON array of entity IDs' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, granularity: { type: 'string', description: 'HOUR, DAY, or WEEK' } }, false, P1_PM_BASE),
    makeP1Tool('p1_get_metric_capabilities', 'List all available metrics and their capabilities', 'GET', '/metric-capabilities', {}, false, P1_PM_BASE),
    makeP1Tool('p1_get_network_scorecard_wifi', 'Get WiFi health score for a location', 'GET', '/locations/{locationId}/wifi-health', { locationId: { type: 'string', description: 'Location ID (get from p1_get_location_tree)' } }),
    makeP1Tool('p1_get_network_scorecard_devices', 'Get device health score for a location', 'GET', '/locations/{locationId}/device-health', { locationId: { type: 'string', description: 'Location ID (get from p1_get_location_tree)' } }),
    makeP1Tool('p1_get_network_scorecard_clients', 'Get client health score for a location', 'GET', '/locations/{locationId}/client-health', { locationId: { type: 'string', description: 'Location ID (get from p1_get_location_tree)' } }),
    makeP1Tool('p1_get_network_scorecard_services', 'Get services health score for a location', 'GET', '/locations/{locationId}/services-health', { locationId: { type: 'string', description: 'Location ID (get from p1_get_location_tree)' } }),
    makeP1Tool('p1_get_copilot_anomalies', 'Get AI-detected network anomalies', 'GET', '/copilot/anomalies', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, locationId: { type: 'string', description: 'Optional location filter' } }),
    makeP1Tool('p1_get_connectivity_experience', 'Get connectivity experience quality index', 'GET', '/copilot/connectivity-experience', { locationId: { type: 'string', description: 'Location ID' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }),
  ];

  const monitoringResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Performance Monitoring',
    domain: `${DOMAIN_PREFIX}.monitoring`,
    description: `Platform One analytics, health scores, and Copilot anomaly detection. ${monitoringTools.filter(t => !t.config.isWrite).length} read ops.`,
    version: '1.0.0',
    capabilities: monitoringTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One performance monitoring. Use p1_network_health_summary composite tool for overall health checks with auto-location resolution. For detailed analytics, use the PM service endpoints. All analytics endpoints require epoch milliseconds for time ranges. NEVER guess locationId — use p1_get_location_tree first.`,
    tools: monitoringTools,
  });
  allSkillIds.push(monitoringResult.skillId);
  totalTools += monitoringTools.length;
  if (monitoringResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.monitoring] ${monitoringTools.length} tools — DB: ${monitoringResult.skillId.slice(-8)} Registry: ${monitoringResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4f. extremep1.topology — Network Visualization
  // ────────────────────────────────────────────────────────────────────────────
  const topologyTools = [
    makeP1Tool('p1_get_topology', 'Get network topology overview', 'GET', '/topology', { locationId: { type: 'string', description: 'Optional location ID to scope topology' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_device_topology', 'Get device-level topology', 'GET', '/topology/devices', { locationId: { type: 'string', description: 'Optional location ID to scope topology' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_device_ports', 'Get all ports for a device', 'GET', '/devices/{id}/ports', { id: { type: 'string', description: 'Device ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_lldp_neighbors', 'Get LLDP/CDP neighbors for a device', 'GET', '/devices/{id}/lldp-neighbors', { id: { type: 'string', description: 'Device ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_device_ssids', 'Get SSIDs advertised by a device', 'GET', '/devices/{id}/ssids', { id: { type: 'string', description: 'Device ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_vlans', 'Get all VLANs in the topology', 'GET', '/services/vlans', { topologyId: { type: 'string', description: 'Topology ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_l2_services', 'Get Layer 2 services/domains', 'GET', '/services/l2s', { topologyId: { type: 'string', description: 'Topology ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_l3_services', 'Get Layer 3 services (VRFs, routing)', 'GET', '/services/l3s', { topologyId: { type: 'string', description: 'Topology ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_vrf_services', 'Get VRF definitions', 'GET', '/services/vrfs', { topologyId: { type: 'string', description: 'Topology ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_topology_tags', 'Get all tags in the topology', 'GET', '/tags', {}, false, P1_NVO_BASE),
    makeP1Tool('p1_get_device_link_topology', 'Get device physical/fabric links', 'GET', '/topology/devices/{id}/links', { id: { type: 'string', description: 'Device ID' } }, false, P1_NVO_BASE),
    makeP1Tool('p1_get_topology_suggestions', 'Search topology entities by name', 'GET', '/suggestions', { query: { type: 'string', description: 'Search query' } }, false, P1_NVO_BASE),
  ];

  const topoResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Network Topology',
    domain: `${DOMAIN_PREFIX}.topology`,
    description: `Platform One network topology and visualization: devices, ports, LLDP, VLANs, L2/L3 services. ${topologyTools.length} read ops.`,
    version: '1.0.0',
    capabilities: topologyTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One network topology and visualization. Use p1_get_topology first for an overview, then drill into specific devices/services. p1_get_lldp_neighbors shows physical connections between devices. Use p1_get_vlans and p1_get_l2_services for network segmentation visibility.`,
    tools: topologyTools,
  });
  allSkillIds.push(topoResult.skillId);
  totalTools += topologyTools.length;
  if (topoResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.topology] ${topologyTools.length} tools — DB: ${topoResult.skillId.slice(-8)} Registry: ${topoResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4g. extremep1.configuration — Network Configuration
  // ────────────────────────────────────────────────────────────────────────────
  const configTools = [
    makeP1Tool('p1_list_network_policies', 'List all network policies', 'GET', '/network-policies', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_get_network_policy', 'Get network policy details', 'GET', '/network-policies/{id}', { id: { type: 'string', description: 'Network policy ID' } }),
    makeP1Tool('p1_list_policy_ssids', 'List SSIDs in a network policy', 'GET', '/network-policies/{policyId}/ssids', { policyId: { type: 'string', description: 'Network policy ID' } }),
    makeP1Tool('p1_list_user_profiles', 'List user profiles/VLANs', 'GET', '/user-profiles', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_get_user_profile', 'Get user profile details including VLAN', 'GET', '/user-profiles/{id}', { id: { type: 'string', description: 'User profile ID' } }),
    makeP1Tool('p1_list_vlan_profiles', 'List VLAN profiles', 'GET', '/network/vlan-profiles', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_radius_servers', 'List RADIUS server configurations', 'GET', '/radius-servers', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_radio_profiles', 'List radio profiles', 'GET', '/radio-profiles', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_channel_plans', 'List channel plan configurations', 'GET', '/channel-plans', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_ssids', 'List all SSIDs across all policies', 'GET', '/ssids', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_push_network_policy', 'Deploy/push network policy to devices', 'POST', '/network-policies/{policyId}/:deploy', { policyId: { type: 'string', description: 'Network policy ID to deploy' } }, true),
    makeP1Tool('p1_list_deployment_configs', 'List deployment configurations', 'GET', '/deployments', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_ldap_servers', 'List LDAP/AD server configurations', 'GET', '/ldap-servers', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
    makeP1Tool('p1_list_tunnel_policies', 'List tunnel concentrator policies', 'GET', '/tunnel-policies', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }),
  ];

  const configResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Network Configuration',
    domain: `${DOMAIN_PREFIX}.configuration`,
    description: `Platform One network policies, SSIDs, VLANs, RADIUS, radio profiles. ${configTools.filter(t => !t.config.isWrite).length} read ops, ${configTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: configTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One network configuration. For VLAN/SSID mapping, use the sequence: list_network_policies → list_policy_ssids → get_user_profile (includes VLAN). Always confirm before pushing policies to devices. The p1_topology_overview composite tool provides a full SSID→VLAN→Client map automatically.`,
    tools: configTools,
  });
  allSkillIds.push(configResult.skillId);
  totalTools += configTools.length;
  if (configResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.configuration] ${configTools.length} tools — DB: ${configResult.skillId.slice(-8)} Registry: ${configResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4h. extremep1.iam — Identity and Access Management
  // ────────────────────────────────────────────────────────────────────────────
  const iamTools = [
    makeP1Tool('p1_list_iam_users', 'List organization users', 'GET', '/users', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, search: { type: 'string', description: 'Search by name or email' } }, false, P1_IAM_BASE),
    makeP1Tool('p1_get_iam_user', 'Get user details', 'GET', '/users/{id}', { id: { type: 'string', description: 'User ID' } }, false, P1_IAM_BASE),
    makeP1Tool('p1_list_iam_roles', 'List available roles', 'GET', '/roles', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_IAM_BASE),
    makeP1Tool('p1_list_iam_groups', 'List user groups', 'GET', '/groups', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_IAM_BASE),
    makeP1Tool('p1_get_my_profile', 'Get current user profile and permissions', 'GET', '/me', {}, false, P1_IAM_BASE),
    makeP1Tool('p1_list_api_keys', 'List API keys (metadata only, not values)', 'GET', '/api-keys', {}, false, P1_IAM_BASE),
    makeP1Tool('p1_create_api_key', 'Create a new API key', 'POST', '/api-keys', { name: { type: 'string', description: 'API key name' }, expiresAt: { type: 'string', description: 'Expiration date (ISO 8601)' } }, true, P1_IAM_BASE),
    makeP1Tool('p1_delete_api_key', 'Delete an API key', 'DELETE', '/api-keys/{id}', { id: { type: 'string', description: 'API key ID' } }, true, P1_IAM_BASE),
    makeP1Tool('p1_list_organizations', 'List organizations/tenants', 'GET', '/organizations', {}, false, P1_IAM_BASE),
    makeP1Tool('p1_list_data_centers', 'List available data centers/regions', 'GET', '/data-centers', {}, false, P1_IAM_BASE),
    makeP1Tool('p1_list_msp_customers', 'List MSP customer accounts (if MSP role)', 'GET', '/msp/customers', {}, false, P1_IAM_BASE),
    makeP1Tool('p1_list_saml_configs', 'List SAML SSO configurations', 'GET', '/saml/asserting-parties', {}, false, P1_IAM_BASE),
  ];

  const iamResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Identity and Access Management',
    domain: `${DOMAIN_PREFIX}.iam`,
    description: `Platform One users, roles, groups, API keys, organizations. ${iamTools.filter(t => !t.config.isWrite).length} read ops, ${iamTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: iamTools.slice(0, 10).map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One identity management. API keys are used for service-to-service authentication. Creating API keys and deleting them require explicit confirmation. Use p1_get_my_profile to verify current authentication and permissions.`,
    tools: iamTools,
  });
  allSkillIds.push(iamResult.skillId);
  totalTools += iamTools.length;
  if (iamResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.iam] ${iamTools.length} tools — DB: ${iamResult.skillId.slice(-8)} Registry: ${iamResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4i. extremep1.audit — Audit Logs and User Activity
  // ────────────────────────────────────────────────────────────────────────────
  const auditTools = [
    makeP1Tool('p1_list_user_activities', 'List all user activity audit logs', 'GET', '/user-activities', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, userId: { type: 'string', description: 'Filter by user ID' }, category: { type: 'string', description: 'Filter by activity category' }, operation: { type: 'string', description: 'Filter by operation type' } }, false, P1_AUDIT_BASE),
    makeP1Tool('p1_get_my_activities', 'Get current user activity history', 'GET', '/me/activities', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }, false, P1_AUDIT_BASE),
    makeP1Tool('p1_export_audit_logs', 'Export audit logs as file', 'GET', '/user-activities/export', { startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' }, format: { type: 'string', description: 'Export format (e.g. CSV)' } }, true, P1_AUDIT_BASE),
    makeP1Tool('p1_list_audit_categories', 'List all audit log categories', 'GET', '/categories', {}, false, P1_AUDIT_BASE),
    makeP1Tool('p1_list_audit_operations', 'List all auditable operation types', 'GET', '/user-operations', {}, false, P1_AUDIT_BASE),
    makeP1Tool('p1_list_audit_apps', 'List all apps that generate audit events', 'GET', '/user-apps', {}, false, P1_AUDIT_BASE),
  ];

  const auditResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Audit Logs',
    domain: `${DOMAIN_PREFIX}.audit`,
    description: `Platform One user activity and audit trail. ${auditTools.filter(t => !t.config.isWrite).length} read ops, ${auditTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: auditTools.map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One audit trail queries. Use time ranges in epoch milliseconds. Category filters help narrow results. Use export for compliance reporting.`,
    tools: auditTools,
  });
  allSkillIds.push(auditResult.skillId);
  totalTools += auditTools.length;
  if (auditResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.audit] ${auditTools.length} tools — DB: ${auditResult.skillId.slice(-8)} Registry: ${auditResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4j. extremep1.assets — Asset Inventory and Lifecycle
  // ────────────────────────────────────────────────────────────────────────────
  const assetTools = [
    makeP1Tool('p1_list_asset_devices', 'List device inventory with rich filtering (supports sortBy, filters for device type, location, firmware)', 'POST', '/devices/fetch', { page: { type: 'number', description: 'Page number' }, pageSize: { type: 'number', description: 'Results per page' }, sortBy: { type: 'string', description: 'Sort field' }, filters: { type: 'string', description: 'JSON array of filter objects' } }, false, P1_ASSET_BASE),
    makeP1Tool('p1_get_asset_firmware_summary', 'Get firmware version distribution across all devices', 'GET', '/devices/firmware-summary', {}, false, P1_ASSET_BASE),
    makeP1Tool('p1_get_firmware_versions', 'Get all available firmware versions', 'GET', '/devices/firmware-versions', {}, false, P1_ASSET_BASE),
    makeP1Tool('p1_get_hardware_lifecycle', 'Get hardware end-of-life/end-of-support information', 'GET', '/devices/hardware-lifecycle', {}, false, P1_ASSET_BASE),
    makeP1Tool('p1_get_subscription_summary', 'Get license subscription summary', 'GET', '/devices/subscriptions-summary', {}, false, P1_ASSET_BASE),
    makeP1Tool('p1_list_contracts', 'List device contracts', 'GET', '/contracts', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_ASSET_BASE),
    makeP1Tool('p1_export_assets', 'Export device inventory', 'GET', '/devices/export', { format: { type: 'string', description: 'Export format (e.g. CSV, XLSX)' } }, true, P1_ASSET_BASE),
  ];

  const assetResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Asset Inventory',
    domain: `${DOMAIN_PREFIX}.assets`,
    description: `Platform One asset management: device inventory, firmware, hardware lifecycle, subscriptions. ${assetTools.filter(t => !t.config.isWrite).length} read ops, ${assetTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: assetTools.map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One asset management. p1_list_asset_devices supports rich filtering including device type, location, firmware version. p1_get_hardware_lifecycle identifies devices approaching end-of-life.`,
    tools: assetTools,
  });
  allSkillIds.push(assetResult.skillId);
  totalTools += assetTools.length;
  if (assetResult.pushed) pushedToRegistry++;
  console.log(`  📖 [${DOMAIN_PREFIX}.assets] ${assetTools.length} tools — DB: ${assetResult.skillId.slice(-8)} Registry: ${assetResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4k. extremep1.notifications — Notification Management
  // ────────────────────────────────────────────────────────────────────────────
  const notifTools = [
    makeP1Tool('p1_list_email_notifications', 'List email notification configurations', 'GET', '/email-notifications', {}, false, P1_NOTIF_BASE),
    makeP1Tool('p1_list_webhook_notifications', 'List webhook notification configurations', 'GET', '/webhook-notifications', {}, false, P1_NOTIF_BASE),
    makeP1Tool('p1_list_servicenow_notifications', 'List ServiceNow integrations', 'GET', '/servicenow-notifications', {}, false, P1_NOTIF_BASE),
    makeP1Tool('p1_create_webhook_notification', 'Create webhook notification', 'POST', '/webhook-notifications', { name: { type: 'string', description: 'Webhook name' }, url: { type: 'string', description: 'Webhook URL' }, events: { type: 'string', description: 'JSON array of event types to forward' } }, true, P1_NOTIF_BASE),
    makeP1Tool('p1_test_webhook', 'Test a webhook notification', 'POST', '/webhook-notifications/{id}/:test', { id: { type: 'string', description: 'Webhook notification ID' } }, true, P1_NOTIF_BASE),
    makeP1Tool('p1_list_notification_rules', 'List notification routing rules', 'GET', '/notification-rules', {}, false, P1_NOTIF_BASE),
    makeP1Tool('p1_create_notification_rule', 'Create notification rule', 'POST', '/notification-rules', { name: { type: 'string', description: 'Rule name' }, conditions: { type: 'string', description: 'JSON conditions object' }, destinations: { type: 'string', description: 'JSON array of destination configs' } }, true, P1_NOTIF_BASE),
  ];

  const notifResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Notifications',
    domain: `${DOMAIN_PREFIX}.notifications`,
    description: `Platform One notification management: email, webhooks, ServiceNow, routing rules. ${notifTools.filter(t => !t.config.isWrite).length} read ops, ${notifTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: notifTools.map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One notifications. Webhooks can forward alerts to external systems (Slack, Teams, etc.). Test webhooks before enabling in production.`,
    tools: notifTools,
  });
  allSkillIds.push(notifResult.skillId);
  totalTools += notifTools.length;
  if (notifResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.notifications] ${notifTools.length} tools — DB: ${notifResult.skillId.slice(-8)} Registry: ${notifResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4l. extremep1.tagging — Tag and Entity Management
  // ────────────────────────────────────────────────────────────────────────────
  const tagTools = [
    makeP1Tool('p1_list_tags', 'List all tags', 'GET', '/tags', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, name: { type: 'string', description: 'Filter by tag name' } }, false, P1_TAG_BASE),
    makeP1Tool('p1_get_tag', 'Get tag details', 'GET', '/tags/{tagId}', { tagId: { type: 'string', description: 'Tag ID' } }, false, P1_TAG_BASE),
    makeP1Tool('p1_create_tag', 'Create a new tag', 'POST', '/tags', { name: { type: 'string', description: 'Tag name' }, value: { type: 'string', description: 'Tag value' }, color: { type: 'string', description: 'Tag color (hex)' } }, true, P1_TAG_BASE),
    makeP1Tool('p1_update_tag', 'Update tag definition', 'PUT', '/tags/{tagId}', { tagId: { type: 'string', description: 'Tag ID' } }, true, P1_TAG_BASE),
    makeP1Tool('p1_delete_tag', 'Delete a tag', 'DELETE', '/tags/{tagId}', { tagId: { type: 'string', description: 'Tag ID' } }, true, P1_TAG_BASE),
    makeP1Tool('p1_list_entities_by_type', 'List tagged entities of a type (device, ap, ssid, etc.)', 'GET', '/entities/{entityType}', { entityType: { type: 'string', description: 'Entity type: device, ap, ssid, switch, etc.' } }, false, P1_TAG_BASE),
    makeP1Tool('p1_associate_tag', 'Associate tag with entities', 'POST', '/associate', { tagId: { type: 'string', description: 'Tag ID' }, entityIds: { type: 'string', description: 'JSON array of entity IDs' }, entityType: { type: 'string', description: 'Entity type' } }, true, P1_TAG_BASE),
    makeP1Tool('p1_disassociate_tag', 'Remove tag from entities', 'POST', '/disassociate', { tagId: { type: 'string', description: 'Tag ID' }, entityIds: { type: 'string', description: 'JSON array of entity IDs' }, entityType: { type: 'string', description: 'Entity type' } }, true, P1_TAG_BASE),
    makeP1Tool('p1_list_tag_policies', 'List tag policies', 'GET', '/policies', {}, false, P1_TAG_BASE),
  ];

  const tagResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — Tagging',
    domain: `${DOMAIN_PREFIX}.tagging`,
    description: `Platform One tag management: create, assign, and manage tags for devices, APs, SSIDs. ${tagTools.filter(t => !t.config.isWrite).length} read ops, ${tagTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: tagTools.map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One tagging and classification. Tags can be applied to devices, APs, SSIDs, and other entities. Use tags for grouping, filtering, and policy application.`,
    tools: tagTools,
  });
  allSkillIds.push(tagResult.skillId);
  totalTools += tagTools.length;
  if (tagResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.tagging] ${tagTools.length} tools — DB: ${tagResult.skillId.slice(-8)} Registry: ${tagResult.pushed ? '✅' : '⚠️'}`);

  // ────────────────────────────────────────────────────────────────────────────
  // 4m. extremep1.sdwan — SD-WAN Management
  // ────────────────────────────────────────────────────────────────────────────
  const sdwanTools = [
    makeP1Tool('p1_sdwan_list_sites', 'List SD-WAN sites', 'GET', '/configuration/v1/sites', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_get_site_360', 'Get 360° view of an SD-WAN site', 'GET', '/monitoring/v1/sites/{id}/overview', { id: { type: 'string', description: 'SD-WAN site ID' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_list_appliances', 'List SD-WAN appliances', 'GET', '/onboarding/v1/appliances', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_get_appliance_360', 'Get SD-WAN appliance health metrics', 'GET', '/monitoring/v1/appliances/{id}/overview', { id: { type: 'string', description: 'Appliance ID' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_list_policies', 'List SD-WAN network policies', 'GET', '/configuration/v1/network-policies', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_get_topology', 'Get SD-WAN topology summary', 'GET', '/monitoring/v1/topology/summary', {}, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_list_alarms', 'List SD-WAN alarms', 'GET', '/monitoring/v1/alarms', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' }, severity: { type: 'string', description: 'Severity filter' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_get_wan_360', 'Get WAN link health metrics', 'GET', '/monitoring/v1/wans/{id}/overview', { id: { type: 'string', description: 'WAN link ID' }, startTime: { type: 'number', description: 'Start time (epoch milliseconds)' }, endTime: { type: 'number', description: 'End time (epoch milliseconds)' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_list_applications', 'List SD-WAN applications', 'GET', '/monitoring/v1/applications', { page: { type: 'number', description: 'Page number' }, limit: { type: 'number', description: 'Results per page' } }, false, P1_SDWAN_BASE),
    makeP1Tool('p1_sdwan_execute_script', 'Execute script on SD-WAN appliances', 'POST', '/scripts/v1/execute', { scriptId: { type: 'string', description: 'Script ID to execute' }, deviceIds: { type: 'string', description: 'JSON array of appliance IDs' } }, true, P1_SDWAN_BASE),
  ];

  const sdwanResult = await upsertSkill(agentId, {
    name: 'Extreme Platform One — SD-WAN',
    domain: `${DOMAIN_PREFIX}.sdwan`,
    description: `Platform One SD-WAN management: sites, appliances, policies, topology, WAN monitoring. ${sdwanTools.filter(t => !t.config.isWrite).length} read ops, ${sdwanTools.filter(t => t.config.isWrite).length} write ops.`,
    version: '1.0.0',
    capabilities: sdwanTools.map(t => t.description.replace(/\[.*?\]\s/, '').replace(' ⚠️ WRITE OPERATION — requires approval', '')),
    systemPrompt: `Expert in Platform One SD-WAN management. The SDWAN service has separate URL path versions (/configuration/v1, /monitoring/v1, /onboarding/v1). Use p1_sdwan_get_topology for network overview. Time ranges use epoch milliseconds.`,
    tools: sdwanTools,
  });
  allSkillIds.push(sdwanResult.skillId);
  totalTools += sdwanTools.length;
  if (sdwanResult.pushed) pushedToRegistry++;
  console.log(`  ✏️  [${DOMAIN_PREFIX}.sdwan] ${sdwanTools.length} tools — DB: ${sdwanResult.skillId.slice(-8)} Registry: ${sdwanResult.pushed ? '✅' : '⚠️'}`);

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  Skills created: ${allSkillIds.length}`);
  console.log(`  Total tools:    ${totalTools}`);
  console.log(`  Pushed to registry: ${pushedToRegistry}/${allSkillIds.length}`);
  console.log(`  Agent ID:       ${agentId}`);
  console.log(`  Credential ID:  ${credentialId}`);
  console.log(`══════════════════════════════════════════════════\n`);

  // ── 5. Composite skill ─────────────────────────────────────────────────────
  console.log('🧩 Creating composite intelligence skill...\n');

  const compositeTools = [
    {
      name: 'p1_clients_by_vendor',
      description: 'List all active wireless clients filtered by vendor/OS (apple/android/windows/linux). Uses OUI lookup, hostname patterns, and os_type detection. Returns hostname, IP, VLAN, SSID, AP name, signal quality per client.',
      handlerType: 'p1_clients_by_vendor',
      config: { isWrite: false, operationId: 'p1_clients_by_vendor' },
      parameters: {
        type: 'object' as const,
        properties: {
          vendor: { type: 'string', description: 'Vendor filter: "apple", "android", "windows", "linux". Default: "apple"' },
          apName: { type: 'string', description: 'Optional: filter to clients on APs whose name contains this string' },
          locationId: { type: 'number', description: 'Optional: filter to a specific location ID' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_client_snapshot',
      description: 'Full status snapshot for a specific client device — current AP, SSID, IP, signal quality, VLAN, and recent events. Use for "where is X connected", "what signal does X have", troubleshooting a named device.',
      handlerType: 'p1_client_snapshot',
      config: { isWrite: false, operationId: 'p1_client_snapshot' },
      parameters: {
        type: 'object' as const,
        properties: {
          clientName: { type: 'string', description: 'Hostname or partial name of the client (e.g. "iPhone-John", "MacBook")' },
          macAddress: { type: 'string', description: 'MAC address of the client (use if known)' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_network_health_summary',
      description: 'Get overall network health score for a location. Resolves location name to ID automatically. Returns WiFi health, device health, client health, and service health scores. Use for "how is the network at Beverly", "show me health scores".',
      handlerType: 'p1_network_health',
      config: { isWrite: false, operationId: 'p1_network_health_summary' },
      parameters: {
        type: 'object' as const,
        properties: {
          locationName: { type: 'string', description: 'Location name to search (e.g. "Beverly", "HQ", "Building A")' },
          locationId: { type: 'number', description: 'Location ID if already known' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_topology_overview',
      description: 'Full network topology with SSID→VLAN→Client mapping. Returns each SSID with its network policy, VLAN assignment, and connected clients. Use for "show topology", "SSID to VLAN map", "network policy overview".',
      handlerType: 'p1_topology_report',
      config: { isWrite: false, operationId: 'p1_topology_overview' },
      parameters: {
        type: 'object' as const,
        properties: {
          ssidFilter: { type: 'string', description: 'Optional: only include SSIDs containing this string' },
          locationId: { type: 'number', description: 'Optional: filter to a specific location' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_device_health_summary',
      description: 'Get device health score for APs/switches at a location. Auto-resolves location name. Returns per-location health breakdown.',
      handlerType: 'p1_device_health',
      config: { isWrite: false, operationId: 'p1_device_health_summary' },
      parameters: {
        type: 'object' as const,
        properties: {
          locationName: { type: 'string', description: 'Location name (e.g. "Beverly"). Resolved automatically.' },
          locationId: { type: 'number', description: 'Location ID if already known' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_radio_quality_report',
      description: 'Get radio quality metrics (SNR, RSSI, noise floor, TX/RX rates) for all APs or a filtered subset. Handles device enumeration automatically. Returns per-AP, per-radio breakdown.',
      handlerType: 'p1_radio_quality',
      config: { isWrite: false, operationId: 'p1_radio_quality_report' },
      parameters: {
        type: 'object' as const,
        properties: {
          apNameFilter: { type: 'string', description: 'Optional: only include APs whose hostname contains this string' },
          radioType: { type: 'string', description: 'Optional: "2.4GHz", "5GHz", or "6GHz"' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_ap_client_distribution',
      description: 'Show client distribution across APs as a Mermaid sankey diagram: Access Points → SSIDs → Client Vendor (Apple/Android/Windows) → Device Type (Phone/Tablet/Laptop). Use for "what devices are on the network", "AP client breakdown", device type distribution.',
      handlerType: 'p1_ap_client_sankey',
      config: { isWrite: false, operationId: 'p1_ap_client_distribution' },
      parameters: {
        type: 'object' as const,
        properties: {
          apFilter: { type: 'string', description: 'Optional: only include clients on APs matching this name' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_alert_summary',
      description: 'Get a comprehensive alert summary: counts by severity, top active alerts, recent events. Use for "any alerts?", "what are the current issues?", "show me active problems".',
      handlerType: 'p1_alert_summary',
      config: { isWrite: false, operationId: 'p1_alert_summary' },
      parameters: {
        type: 'object' as const,
        properties: {
          locationId: { type: 'number', description: 'Optional: filter alerts to a specific location' },
          severities: { type: 'string', description: 'Optional: comma-separated severity filter (CRITICAL,MAJOR,MINOR,WARNING,INFO)' },
        },
        required: [] as string[],
      },
    },
    {
      name: 'p1_client_health_report',
      description: 'Client health report for all active wireless clients — signal quality, retry rate, health classification. Use for "show clients with poor signal", "which clients have connectivity issues".',
      handlerType: 'p1_client_health_report',
      config: { isWrite: false, operationId: 'p1_client_health_report' },
      parameters: {
        type: 'object' as const,
        properties: {
          healthFilter: { type: 'string', description: 'Optional: "poor", "fair", or "good"' },
          apFilter: { type: 'string', description: 'Optional: only clients on APs matching this name' },
        },
        required: [] as string[],
      },
    },
  ];

  const compositeDomain = `${DOMAIN_PREFIX}.composite`;
  const compositeSkillRecord = {
    name: 'Extreme Platform One — Composite Intelligence Tools',
    domain: compositeDomain,
    version: '1.0.0',
    description: 'Multi-step composite tools that handle Platform One API chaining automatically. Use for vendor queries, radio quality, topology, client snapshots, health summaries, and alerts.',
    capabilities: compositeTools.map(t => t.description.slice(0, 80)),
    systemPrompt: `You have access to pre-built composite tools that handle complex multi-step Platform One queries automatically.

ALWAYS prefer composite tools over raw API calls when they cover the query:
- Apple/Android/Windows/Linux clients → p1_clients_by_vendor
- Single device status/location → p1_client_snapshot
- Network health score → p1_network_health_summary (auto-resolves location name)
- Device health score → p1_device_health_summary (auto-resolves location name)
- SSID/VLAN topology map → p1_topology_overview
- Radio quality, SNR, signal → p1_radio_quality_report (handles device enumeration)
- AP/SSID/Vendor/DeviceType flow → p1_ap_client_distribution (Mermaid sankey diagram)
- Current alert status → p1_alert_summary
- All clients health/signal → p1_client_health_report

These tools handle all required API chaining automatically.

OUTPUT FORMAT FOR DIAGRAMS: When p1_ap_client_distribution returns a result, the "sankey_diagram" field contains valid Mermaid sankey-beta syntax. Return this field as-is in your JSON response so the dashboard renders it as a Mermaid widget.`,
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

  // Update credential permissions
  await prisma.credential.update({
    where: { id: credentialId },
    data: { allowedAgentPermissions: ['p1:read', 'p1:write', 'xiq:read', 'xiq:write', '*'] },
  });

  // ── 6. Seed learnedNotes ───────────────────────────────────────────────────
  console.log('\n📝 Seeding learnedNotes for key skills...');
  try {
    const learnedNotesMap: Record<string, string> = {
      [`${DOMAIN_PREFIX}.devices`]:
        'Radio information endpoint requires numeric deviceIds as repeated query params (not comma-joined). Always call p1_list_devices first. Use p1_radio_quality_report composite tool which handles this automatically.',
      [`${DOMAIN_PREFIX}.clients`]:
        'For vendor/manufacturer filtering use p1_clients_by_vendor composite tool (handles OUI, hostname, os_type). For wired clients use p1_list_wired_clients_grid. views parameter: BASIC (default), FULL, CLIENT_DETAILS, HEALTH_STATUS.',
      [`${DOMAIN_PREFIX}.alerts`]:
        'NEVER use sortField/order parameters — causes 400 BAD_REQUEST. Use severities filter (CRITICAL,MAJOR,MINOR,WARNING,INFO). Use p1_alert_summary composite for quick overview.',
      [`${DOMAIN_PREFIX}.monitoring`]:
        'NEVER guess locationId. Use p1_get_location_tree to find location IDs. All analytics are POST with JSON body. Time in epoch milliseconds. Granularity: HOUR, DAY, WEEK.',
      [`${DOMAIN_PREFIX}.composite`]:
        'Use p1_clients_by_vendor for Apple/Android/Windows client queries. Use p1_network_health_summary/p1_device_health_summary for health scores (auto-resolves location names). Use p1_topology_overview for SSID→VLAN mapping. Use p1_alert_summary for current alert status. Use p1_radio_quality_report for radio/signal/SNR metrics.',
      [`${DOMAIN_PREFIX}.configuration`]:
        'VLAN resolution: list_network_policies → list_policy_ssids → get_user_profile (has VLAN ID). Use p1_topology_overview composite for automatic mapping. Never push policies without confirmation.',
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

  // ── 7. Final summary ───────────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  FINAL — Skills: ${allSkillIds.length} | Tools: ${totalTools} | Registry: ${pushedToRegistry}/${allSkillIds.length}`);
  console.log(`  Agent ID:      ${agentId}`);
  console.log(`  Credential ID: ${credentialId}`);
  console.log(`══════════════════════════════════════════════════\n`);

  const summary = `✅ Extreme Platform One full skill set ready!

${allSkillIds.length} skills | ${totalTools} tools | ${pushedToRegistry} in registry

Skills cover:
- Devices (list, reboot, firmware, location)
- Clients (wireless, wired, disconnect, usage)
- Sites & Locations (hierarchy tree, buildings, floors)
- Alerts & Events (severities, acknowledge, clear)
- Performance Monitoring (analytics, health scores, Copilot)
- Network Topology (LLDP, VLANs, L2/L3, VRFs)
- Network Configuration (policies, SSIDs, VLANs, RADIUS)
- IAM (users, roles, API keys, SAML)
- Audit Logs (user activity, export)
- Asset Inventory (firmware, lifecycle, subscriptions)
- Notifications (email, webhooks, ServiceNow)
- Tagging (create, assign, entity management)
- SD-WAN (sites, appliances, policies, WAN monitoring)
- 🧩 Composite tools: vendor queries, radio quality, topology, health summaries, alerts

Auth: Bearer token (system.extremep1_api_token)
Write operations require your approval before executing.

Try: "List all Apple clients" or "Show network health at HQ" or "Any critical alerts?"`;

  await sendTelegram(summary);
  console.log('📱 Telegram notification sent');
  console.log('\nDone! Update TELEGRAM_DEFAULT_AGENT_ID to', agentId, 'to use via Telegram.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
