/**
 * seed-xco-full.ts
 *
 * Sets up ExtremeCloud Orchestrator (XCO / EFA) skills, agents, and credentials.
 * Uses hand-crafted tools with handlerType: 'xco_http_call' so the orchestrator
 * can authenticate and call XCO's REST API automatically.
 *
 * Usage:
 *   XCO_HOST=10.64.160.100 XCO_USERNAME=extreme XCO_PASSWORD=password \
 *     npx tsx scripts/seed-xco-full.ts
 */
import { PrismaClient } from '@prisma/client';
import { CredentialVaultService } from '../packages/credential-vault/src/service.js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) config({ path: envPath });

const prisma = new PrismaClient();
const vault = new CredentialVaultService(prisma);

const XCO_HOST     = process.env['XCO_HOST']     ?? '';
const XCO_USERNAME = process.env['XCO_USERNAME'] ?? 'extreme';
const XCO_PASSWORD = process.env['XCO_PASSWORD'] ?? 'password';
// Use {xco-host} placeholder so the Endpoint record drives the URL at runtime.
// If XCO_HOST is provided, it is stored in the Endpoint record; skills always
// use the placeholder so changing the endpoint automatically applies everywhere.
const XCO_BASE_URL = 'https://{xco-host}/v1';
const XCO_AUTH_URL = 'https://{xco-host}/v1/auth/token/access-token';

const REGISTRY_URL   = process.env['SKILL_REGISTRY_URL']   ?? 'http://localhost:5050';
const REGISTRY_TOKEN = process.env['SKILL_REGISTRY_TOKEN'] ?? 'bex-registry-dev';
const llmProviderRaw = process.env['LLM_PROVIDER'] ?? 'openai';
const LLM_PROVIDER   = (llmProviderRaw === 'azure' ? 'azure-openai' : llmProviderRaw) as 'openai' | 'anthropic' | 'azure-openai' | 'ollama';
const LLM_MODEL      = process.env['LLM_MODEL'] ?? 'gpt-4o';

function log(msg: string)  { console.log(`\n[XCO-SEED] ${msg}`); }
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function info(msg: string) { console.log(`  → ${msg}`); }

// ─── Tool factory ─────────────────────────────────────────────────────────────

function makeTool(
  name: string,
  description: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  urlPath: string,
  params: Record<string, { type: string; description: string; in?: string }> = {},
  isWrite = false,
) {
  const urlTemplate = `${XCO_BASE_URL}${urlPath}`;
  const required = Object.entries(params)
    .filter(([, v]) => (v as any).required === true)
    .map(([k]) => k);

  const properties: Record<string, { type: string; description: string }> = {};
  for (const [k, v] of Object.entries(params)) {
    properties[k] = { type: v.type, description: v.description };
  }

  return {
    name,
    description: `[${method}] ${description}${isWrite ? ' ⚠️ WRITE — requires approval' : ''}`,
    handlerType: 'xco_http_call',
    config: {
      method,
      urlTemplate,
      authUrl: XCO_AUTH_URL,
      isWrite,
      operationId: name,
    },
    parameters: {
      type: 'object' as const,
      properties,
      required,
    },
  };
}

// ─── Skill definitions ────────────────────────────────────────────────────────

const MONITOR_TOOLS = [
  makeTool('xco_get_inventory', 'List all registered switches/devices in XCO inventory (optionally filtered by fabric)', 'GET',
    '/inventory/switches', {
      fabric_name: { type: 'string', description: 'Filter by fabric name (optional)' },
    }),

  makeTool('xco_get_switch_config', 'Get configuration and settings for a specific switch', 'GET',
    '/inventory/switchconfig/setting', {
      ip_address: { type: 'string', description: 'Management IP address of the switch (required)' },
    }),

  makeTool('xco_get_rma_history', 'Get device RMA (Return Merchandise Authorization) history', 'GET',
    '/inventory/rma-history', {}),

  makeTool('xco_get_alarm_summary', 'Get alarm counts grouped by severity (Critical/Major/Minor/Warning/Info)', 'GET',
    '/faultmanager/alarm/summary', {}),

  makeTool('xco_get_alarm_inventory', 'List all currently active (uncleared) alarms', 'GET',
    '/faultmanager/alarm/inventory', {
      severity:  { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      page_size: { type: 'integer', description: 'Page size (default 20)' },
    }),

  makeTool('xco_get_alarm_history', 'Get historical alarm records with optional filters', 'GET',
    '/faultmanager/alarm/history', {
      severity:  { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      unacked:   { type: 'boolean', description: 'Only unacknowledged alarms' },
      cleared:   { type: 'boolean', description: 'Include cleared alarms (default false)' },
      detail:    { type: 'boolean', description: 'Return full detail' },
      page_size: { type: 'integer', description: 'Page size (default 20)' },
      sort_by:   { type: 'string', description: 'Sort direction: asc or desc' },
    }),

  makeTool('xco_get_alert_inventory', 'List all currently active alerts', 'GET',
    '/faultmanager/alert/inventory', {
      severity: { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
    }),

  makeTool('xco_get_alert_history', 'Get historical alert records', 'GET',
    '/faultmanager/alert/history', {
      severity: { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      limit:    { type: 'integer', description: 'Max results (default 50)' },
    }),

  makeTool('xco_get_fabrics', 'List all IP fabrics with status and device counts', 'GET',
    '/fabric/fabrics', {}),

  makeTool('xco_get_fabric_detail', 'Get detailed information for a specific fabric', 'GET',
    '/fabric/fabric', {
      name:   { type: 'string', description: 'Name of the fabric to retrieve (required)' },
      detail: { type: 'boolean', description: 'Return full detail including node counts' },
    }),

  makeTool('xco_get_fabric_health', 'Get health status for all fabrics (or a specific one)', 'GET',
    '/fabric/fabrics-health', {
      'fabric-name': { type: 'string', description: 'Filter to a specific fabric (optional)' },
    }),

  makeTool('xco_get_fabric_errors', 'Get fabric configuration errors across all fabrics (or a specific one)', 'GET',
    '/fabric/fabrics/errors', {
      'fabric-name': { type: 'string', description: 'Filter to a specific fabric name (optional)' },
    }),

  makeTool('xco_validate_fabric', 'Validate CLOS topology — find missing links, drift, redundant links', 'GET',
    '/fabric/validate', {
      'fabric-name': { type: 'string', description: 'Name of the fabric to validate (required)' },
    }),

  makeTool('xco_get_system_settings', 'Get XCO platform-wide system settings', 'GET',
    '/system/settings', {}),

  makeTool('xco_get_system_feature', 'Get XCO feature flags and platform health status', 'GET',
    '/system/feature', {}),

  makeTool('xco_get_rbac_roles', 'List all RBAC roles defined in XCO', 'GET',
    '/rbac/roles', {}),

  makeTool('xco_get_tenants', 'List all tenants (VRF / tenant network groupings) in XCO', 'GET',
    '/tenant/tenants', {}),

  makeTool('xco_get_notification_subscribers', 'List all notification subscribers configured in XCO', 'GET',
    '/notification/subscribers', {}),

  makeTool('xco_get_snmp_subscribers', 'List all SNMP trap subscribers configured in XCO', 'GET',
    '/snmp/subscribers', {}),
];

const OPERATIONS_TOOLS = [
  makeTool('xco_ack_alarms', 'Acknowledge active alarms by instance_id range', 'PUT',
    '/faultmanager/alarm/acknowledge', {
      instance_id: { type: 'string', description: 'Alarm instance IDs — comma-separated or range e.g. 2,3,5-10' },
      resource:    { type: 'string', description: 'Resource path filter (optional)' },
      comment:     { type: 'string', description: 'Comment explaining the acknowledgement' },
    }, true),

  makeTool('xco_close_alarms', 'Close raised or cleared alarms by instance_id', 'PUT',
    '/faultmanager/alarm/close', {
      instance_id: { type: 'string', description: 'Alarm instance IDs — comma-separated or range' },
      resource:    { type: 'string', description: 'Resource path filter (optional)' },
      comment:     { type: 'string', description: 'Comment explaining the closure' },
    }, true),

  makeTool('xco_purge_alarms', 'Purge ALL closed alarms — IRREVERSIBLE', 'DELETE',
    '/faultmanager/alarm/purge', {}, true),

  makeTool('xco_create_fabric', 'Create a new IP Fabric (CLOS or non-CLOS)', 'POST',
    '/fabric/fabric', {
      name:        { type: 'string', description: 'Fabric name (e.g. PROD-DC1)' },
      description: { type: 'string', description: 'Fabric description' },
      stage:       { type: 'integer', description: 'CLOS stage: 3, 5, or 7' },
      type:        { type: 'string', description: 'Fabric type: clos or non-clos' },
    }, true),

  makeTool('xco_delete_fabric', 'Delete an existing fabric and all its configuration', 'DELETE',
    '/fabric/fabric', {
      name:  { type: 'string', description: 'Fabric name to delete' },
      force: { type: 'boolean', description: 'Force delete even with registered devices' },
    }, true),

  makeTool('xco_register_device', 'Register a new switch/device to XCO inventory', 'POST',
    '/inventory/switch', {
      ip_address: { type: 'string', description: 'Management IP address of the switch' },
      username:   { type: 'string', description: 'Switch admin username' },
      password:   { type: 'string', description: 'Switch admin password' },
      fabric:     { type: 'string', description: 'Fabric name to register to' },
    }, true),

  makeTool('xco_remove_device', 'Remove a device from XCO inventory', 'DELETE',
    '/inventory/switch', {
      ip_address: { type: 'string', description: 'IP address of the device to remove' },
    }, true),

  makeTool('xco_update_device_setting', 'Update a switch configuration setting (e.g. maintenance_mode_on_reboot)', 'PUT',
    '/inventory/switchconfig/setting', {
      ip_address: { type: 'string', description: 'Management IP address of the switch' },
      key:        { type: 'string', description: 'Setting key (e.g. maintenance_mode_on_reboot)' },
      value:      { type: 'string', description: 'Setting value (e.g. Yes or No)' },
    }, true),
];

const DIAGNOSTIC_TOOLS = [
  makeTool('xco_get_bgp_sessions', 'List all BGP peer sessions with their current state (ESTABLISHED/IDLE/ACTIVE)', 'GET', '/monitor/bgp'),
  makeTool('xco_get_interface_status', 'Get current status and utilization for all interfaces on all switches (or filtered by switch IP)', 'GET', '/monitor/interface',
    { ip_address: { type: 'string', description: 'Filter to a specific switch management IP (optional)' } }),
  makeTool('xco_get_vtep_status', 'Get VXLAN Tunnel Endpoint (VTEP) health and reachability status', 'GET', '/monitor/vtep'),
  makeTool('xco_get_lldp_neighbors', 'Get LLDP neighbor table — physical adjacency between all switches', 'GET', '/monitor/lldp',
    { ip_address: { type: 'string', description: 'Filter to neighbors of a specific switch IP (optional)' } }),
  makeTool('xco_get_event_log', 'Get system event log with optional time and severity filters', 'GET', '/event', {
    start_time:  { type: 'string', description: 'Start timestamp in ISO 8601 format (optional)' },
    end_time:    { type: 'string', description: 'End timestamp in ISO 8601 format (optional)' },
    severity:    { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info (optional)' },
    page_size:   { type: 'integer', description: 'Results per page (default 50)' } as unknown as { type: string; description: string },
  }),
  makeTool('xco_get_audit_log', 'Get configuration change audit trail — who changed what and when', 'GET', '/audit', {
    start_time:  { type: 'string', description: 'Start timestamp in ISO 8601 format (optional)' },
    end_time:    { type: 'string', description: 'End timestamp in ISO 8601 format (optional)' },
    page_size:   { type: 'integer', description: 'Results per page (default 50)' } as unknown as { type: string; description: string },
  }),
];

const TELEMETRY_TOOLS = [
  makeTool('xco_get_device_telemetry', 'Get CPU, memory, and temperature telemetry for a specific switch', 'GET', '/monitor/device/telemetry',
    { ip_address: { type: 'string', description: 'Management IP address of the switch (required)' } }),
  makeTool('xco_get_interface_utilization', 'Get traffic utilization rates (bytes/packets in+out) for interfaces over a time window', 'GET', '/monitor/interface/utilization', {
    ip_address:  { type: 'string', description: 'Filter to a specific switch management IP (optional)' },
    interface:   { type: 'string', description: 'Filter to a specific interface name, e.g. "Ethernet 0/1" (optional)' },
    window_mins: { type: 'integer', description: 'Time window in minutes (default 5)' } as unknown as { type: string; description: string },
  }),
  makeTool('xco_get_fabric_utilization', 'Get aggregate east-west traffic utilization summary for all fabrics', 'GET', '/monitor/fabric/utilization', {
    fabric_name: { type: 'string', description: 'Filter to a specific fabric (optional)' },
  }),
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await prisma.$connect();
  log(`XCO Seed — host: ${XCO_HOST || '(none — set XCO_HOST)'} | user: ${XCO_USERNAME}`);

  // ── 1. System user ─────────────────────────────────────────────────────────
  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true } });
  if (!systemUser) throw new Error('No system user found — run db:seed first');
  ok(`System user: ${systemUser.id}`);

  // ── 1b. Endpoint record ─────────────────────────────────────────────────────
  // The Endpoint drives the actual host URL at runtime via the {xco-host} placeholder.
  // Credentials are stored in the vault — never in skill definitions.
  log('Upserting XCO Endpoint record...');
  const xcoBaseUrlForEndpoint = XCO_HOST ? `https://${XCO_HOST}` : 'https://xco.local';
  const existingEp = await prisma.endpoint.findFirst({ where: { name: 'main-xco' } });
  if (existingEp) {
    await prisma.endpoint.update({
      where: { id: existingEp.id },
      data: { baseUrl: xcoBaseUrlForEndpoint, tags: ['xco', 'extreme-xco'] },
    });
    ok(`Updated endpoint: ${existingEp.id} → ${xcoBaseUrlForEndpoint}`);
  } else {
    const ep = await prisma.endpoint.create({
      data: {
        name: 'main-xco',
        description: 'ExtremeCloud Orchestrator (EFA) REST API endpoint',
        baseUrl: xcoBaseUrlForEndpoint,
        tags: ['xco', 'extreme-xco'],
        aliases: ['xco', 'efa', 'orchestrator'],
        sshEnabled: true,
        hostname: XCO_HOST || 'xco.local',
        sshPort: 22,
      },
    });
    ok(`Created endpoint: ${ep.id} → ${xcoBaseUrlForEndpoint}`);
  }

  // ── 2. Credential in vault ──────────────────────────────────────────────────
  log('Storing XCO credentials in vault...');

  // Check for existing credential
  let credId: string | null = null;
  const existingCred = await prisma.credential.findFirst({
    where: { name: 'system.xco_credentials' },
  });

  if (existingCred) {
    info(`Found existing credential: ${existingCred.id}`);
    // Update encrypted value directly
    const { encrypt } = await import('../packages/credential-vault/src/crypto.js');
    const blob = encrypt({ baseUrl: XCO_BASE_URL, username: XCO_USERNAME, password: XCO_PASSWORD, xco_host: XCO_HOST });
    await prisma.credential.update({
      where: { id: existingCred.id },
      data: { encryptedValue: blob.encryptedValue, iv: blob.iv, authTag: blob.authTag },
    });
    credId = existingCred.id;
    ok(`Updated credential: ${credId}`);
  } else {
    const cred = await vault.create({
      name: 'system.xco_credentials',
      scope: 'SYSTEM',
      credentialType: 'USERNAME_PASSWORD',
      value: {
        baseUrl: XCO_BASE_URL,
        username: XCO_USERNAME,
        password: XCO_PASSWORD,
        xco_host: XCO_HOST,
      },
      allowedAgentPermissions: ['read:data', 'read:metrics', 'write:alarms', 'write:fabric', 'write:devices', 'ssh:exec'],
    });
    credId = cred.id;
    ok(`Created credential: ${credId}`);
  }

  // Per-agent credential (username/password keys for xco_http_call compatibility)
  let agentCredId: string | null = null;
  const agentCredName = `ExtremeCloud Orchestrator (${XCO_USERNAME}@${XCO_HOST})`;
  const existingAgentCred = await prisma.credential.findFirst({ where: { name: agentCredName } });
  if (existingAgentCred) {
    const { encrypt } = await import('../packages/credential-vault/src/crypto.js');
    const blob = encrypt({ username: XCO_USERNAME, password: XCO_PASSWORD });
    await prisma.credential.update({
      where: { id: existingAgentCred.id },
      data: { encryptedValue: blob.encryptedValue, iv: blob.iv, authTag: blob.authTag },
    });
    agentCredId = existingAgentCred.id;
    ok(`Updated agent credential: ${agentCredId}`);
  } else {
    const agentCred = await vault.create({
      name: agentCredName,
      scope: 'SYSTEM',
      credentialType: 'USERNAME_PASSWORD',
      value: { username: XCO_USERNAME, password: XCO_PASSWORD },
      allowedAgentPermissions: ['read:data', 'read:metrics', 'write:alarms', 'write:fabric', 'write:devices'],
    });
    agentCredId = agentCred.id;
    ok(`Created agent credential: ${agentCredId}`);
  }

  // ── 3. Clean up old XCO skills / agents ────────────────────────────────────
  log('Cleaning up any existing XCO agents and skills...');
  const oldAgents = await prisma.agent.findMany({
    where: { name: { in: ['XCO Monitor', 'XCO Operator', 'XCO Provisioner'] } },
    select: { id: true, name: true },
  });
  for (const a of oldAgents) {
    await prisma.agentSkill.deleteMany({ where: { agentId: a.id } });
    await prisma.scheduledJob.deleteMany({ where: { agentId: a.id } });
    await prisma.agentRequest.deleteMany({ where: { agentId: a.id } });
    if (a.id) {
      const agent = await prisma.agent.findUnique({ where: { id: a.id }, select: { charterId: true } });
      await prisma.agent.delete({ where: { id: a.id } });
      if (agent?.charterId) await prisma.agentCharter.deleteMany({ where: { id: agent.charterId } }).catch(() => {});
    }
    info(`Deleted old agent: ${a.name}`);
  }

  const oldSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'networking.extreme-xco' } },
    select: { id: true, domain: true },
  });
  for (const s of oldSkills) {
    await prisma.agentSkill.deleteMany({ where: { skillId: s.id } });
    await prisma.skill.delete({ where: { id: s.id } });
    info(`Deleted old skill: ${s.domain}`);
  }

  // ── 4. Create skills ────────────────────────────────────────────────────────
  log('Creating XCO Monitor skill (read-only)...');
  const monitorSkill = await prisma.skill.create({
    data: {
      name: 'ExtremeCloud Orchestrator — Monitor',
      domain: 'networking.extreme-xco.monitor',
      version: '1.0.0',
      status: 'PUBLISHED',
      description: 'Read-only monitoring for XCO: device inventory, fabric health, alarms, topology validation, platform health.',
      capabilities: [
        'List all registered network devices/switches',
        'Get alarm summary by severity',
        'Get fabric topology and status',
        'Validate CLOS fabric topology',
        'Check XCO platform service health',
      ],
      tools: MONITOR_TOOLS as any,
      requiredCredentialType: 'USERNAME_PASSWORD',
      systemPrompt: `You are an ExtremeCloud Orchestrator (XCO/EFA) monitoring specialist.

XCO manages IP Fabrics (CLOS and non-CLOS) on Extreme Networks switches (SLX, VDX).
All API calls go through HTTPS port 443 via Traefik to the appropriate microservice.
Base URL: ${XCO_BASE_URL}

ALWAYS start by calling xco_get_inventory to list devices.
- Each switch has: ip_address, name, model, firmware, discovery_status, fabric

For alarm queries:
- Use xco_get_alarm_summary for a count overview
- Use xco_get_alarm_inventory for the current active alarm list
- Use xco_get_alarm_history with severity=Critical for historical critical alarms
- "Uncleared" alarms = IsCleared: false

For fabric health:
- Use xco_get_fabrics to list all fabrics
- Use xco_get_fabric_detail with a specific name for full configuration
- Use xco_get_fabric_health for health status across all fabrics
- Use xco_get_fabric_errors to identify configuration errors
- Use xco_validate_fabric to find topology issues (CLOS fabrics only)

For platform health:
- Use xco_get_system_feature to check feature flags and service status
- Use xco_get_system_settings for platform-wide configuration

Device state values: Completed, Not-Started, In-Progress, Failed
If any device is not in "Completed" state, flag it.

OUTPUT FORMAT:
- For conversational queries: respond in plain English with clear summaries.
- When the request mentions "dashboard", "JSON", "structured data", or "export": respond with a single JSON object only — no markdown, no prose. Use snake_case keys. Arrays of objects should have consistent flat keys (e.g. { "devices": [...], "fabrics": [...], "alarm_summary": {...} }).`,
    },
  });
  ok(`Monitor skill: ${monitorSkill.id}`);
  info(`Tools: ${MONITOR_TOOLS.map(t => t.name).join(', ')}`);

  log('Creating XCO Operations skill (write operations)...');
  const opsSkill = await prisma.skill.create({
    data: {
      name: 'ExtremeCloud Orchestrator — Operations',
      domain: 'networking.extreme-xco.operations',
      version: '1.0.0',
      status: 'PUBLISHED',
      description: 'Write operations for XCO: alarm management, fabric lifecycle, device registration.',
      capabilities: [
        'Acknowledge and close alarms',
        'Create and delete IP fabrics',
        'Register and remove switches',
        'Update device maintenance settings',
      ],
      tools: OPERATIONS_TOOLS as any,
      requiredCredentialType: 'USERNAME_PASSWORD',
      systemPrompt: `You are an ExtremeCloud Orchestrator (XCO/EFA) operator.

ALL tools in this skill are WRITE operations — always confirm before executing.
Before any write:
1. Read current state first (use xco_get_inventory, xco_get_fabrics etc from the monitor skill)
2. Describe exactly what you will change and why
3. Wait for user confirmation

Alarm operations:
- xco_ack_alarms: Use a meaningful comment. instance_id format: "2,3" or "5-10"
- xco_close_alarms: Only close genuinely resolved alarms
- xco_purge_alarms: IRREVERSIBLE — never run without explicit "purge all closed alarms" instruction

Fabric operations:
- stage: 3 = 3-stage CLOS, 5 = 5-stage CLOS, 7 = 7-stage CLOS
- Verify switch count matches stage before creating
- fabric type: "clos" or "non-clos"`,
    },
  });
  ok(`Operations skill: ${opsSkill.id}`);
  info(`Tools: ${OPERATIONS_TOOLS.map(t => t.name).join(', ')}`);

  log('Creating XCO Diagnostics skill (read-only)...');
  const diagnosticsSkill = await prisma.skill.create({
    data: {
      name: 'ExtremeCloud Orchestrator — Diagnostics',
      domain: 'networking.extreme-xco.diagnostics',
      version: '1.0.0',
      status: 'PUBLISHED',
      description: 'Network diagnostics for XCO: BGP session state, interface status, VTEP health, LLDP adjacency, event and audit logs.',
      capabilities: [
        'List BGP peer sessions and their state',
        'Get interface status and utilization per switch',
        'Get VXLAN VTEP health and reachability',
        'Get LLDP physical neighbor table',
        'Query system event log with time/severity filters',
        'Query configuration change audit trail',
      ],
      tools: DIAGNOSTIC_TOOLS as any,
      requiredCredentialType: 'USERNAME_PASSWORD',
      systemPrompt: `You are an ExtremeCloud Orchestrator (XCO/EFA) network diagnostics specialist.

Use these tools to diagnose BGP, interface, and overlay (VXLAN/VTEP) issues.
Base URL: ${XCO_BASE_URL}

BGP troubleshooting workflow:
1. xco_get_bgp_sessions → identify peers not in ESTABLISHED state
2. xco_get_interface_status for that switch → check physical link state
3. xco_get_lldp_neighbors → confirm physical adjacency
4. If interface UP + BGP DOWN → likely configuration mismatch
5. If interface DOWN → physical or optic issue

For event/audit history, always include start_time/end_time in ISO 8601 format when possible.
Correlate events with xco_get_alarm_inventory (from the monitor skill) for full picture.

OUTPUT FORMAT:
- Conversational queries: plain English summaries with clear next steps.
- When "JSON", "dashboard", or "export" is requested: respond with a single JSON object only — no markdown, no prose.`,
    },
  });
  ok(`Diagnostics skill: ${diagnosticsSkill.id}`);
  info(`Tools: ${DIAGNOSTIC_TOOLS.map(t => t.name).join(', ')}`);

  log('Creating XCO Telemetry skill (read-only)...');
  const telemetrySkill = await prisma.skill.create({
    data: {
      name: 'ExtremeCloud Orchestrator — Telemetry',
      domain: 'networking.extreme-xco.telemetry',
      version: '1.0.0',
      status: 'PUBLISHED',
      description: 'Real-time telemetry for XCO: device CPU/memory/temperature, interface utilization rates, fabric east-west traffic summary.',
      capabilities: [
        'Get CPU, memory, and temperature telemetry per switch',
        'Get per-interface traffic utilization over a time window',
        'Get aggregate east-west fabric utilization summary',
      ],
      tools: TELEMETRY_TOOLS as any,
      requiredCredentialType: 'USERNAME_PASSWORD',
      systemPrompt: `You are an ExtremeCloud Orchestrator (XCO/EFA) telemetry specialist.

Use these tools to surface real-time performance data from the fabric.
Base URL: ${XCO_BASE_URL}

Device telemetry requires a switch management IP — always call xco_get_inventory first to enumerate IPs.
- xco_get_device_telemetry: per-switch CPU%, memory%, temperature
- xco_get_interface_utilization: per-port bytes/packets in+out over window_mins (default 5 min)
- xco_get_fabric_utilization: aggregate east-west summary across all (or one) fabric

When comparing utilization across switches, iterate over each IP from inventory.

OUTPUT FORMAT:
- Conversational queries: plain English summaries with units (%, Mbps, etc.).
- When "JSON", "dashboard", or "export" is requested: respond with a single JSON object only — no markdown, no prose.`,
    },
  });
  ok(`Telemetry skill: ${telemetrySkill.id}`);
  info(`Tools: ${TELEMETRY_TOOLS.map(t => t.name).join(', ')}`);

  // ── 4c. Topology composite skill ───────────────────────────────────────────
  log('Creating XCO Topology Mermaid composite skill...');
  const topoCompositeTool = {
    name: 'xco_topology_mermaid',
    description: 'Build a Mermaid graph LR topology diagram of the XCO fabric. Returns topology_diagram (Mermaid string showing spines, leaves, and LLDP links with health colouring), plus switches and fabrics arrays for table display.',
    handlerType: 'xco_topology_mermaid',
    config: {
      authUrl: XCO_AUTH_URL,
      baseUrl: XCO_BASE_URL,
      isWrite: false,
      operationId: 'xco_topology_mermaid',
    },
    parameters: {
      type: 'object' as const,
      properties: {
        fabricFilter: { type: 'string', description: 'Optional: only include switches belonging to this fabric name' },
      },
      required: [] as string[],
    },
  };

  const topoCompositeDomain = 'networking.extreme-xco.composite';
  const existingTopoComposite = await prisma.skill.findFirst({ where: { domain: topoCompositeDomain }, select: { id: true } });
  let topoCompositeId: string;
  const topoCompositeRecord = {
    name: 'ExtremeCloud Orchestrator — Composite Intelligence Tools',
    domain: topoCompositeDomain,
    version: '1.0.0',
    status: 'PUBLISHED' as const,
    description: 'Composite tools for XCO that perform multi-step operations. Includes topology diagram generation using Mermaid graph LR.',
    capabilities: [topoCompositeTool.description.slice(0, 80)],
    tools: [topoCompositeTool],
    requiredCredentialType: 'USERNAME_PASSWORD',
    systemPrompt: `You have access to pre-built composite tools for ExtremeCloud Orchestrator.

ALWAYS use composite tools when they cover the query:
- Fabric topology diagram, network map, spine/leaf view → xco_topology_mermaid

xco_topology_mermaid returns:
  - "topology_diagram": a Mermaid "graph LR" string showing each switch as a node (spines as stadium, leaves as box), grouped into fabric subgraphs, with LLDP edges showing physical links. Nodes are health-coloured (green=in-sync, amber=drift, red=error/unreachable).
  - "switches": array of { name, ip, fabric, role, state, model } for table display
  - "fabrics": array of { name, status, type, stage }

OUTPUT FORMAT: When generating a topology diagram dashboard, return a JSON object with exactly these top-level keys:
  { "topology_diagram": "<mermaid string>", "summary": {...}, "switches": [...], "fabrics": [...] }
Do NOT wrap the diagram string in markdown fences — return it as a plain string value in the JSON.`,
    learnedNotes: 'xco_topology_mermaid fetches /inventory/switches + /monitor/lldp + /fabric/fabrics in parallel and builds a Mermaid graph LR. The topology_diagram field contains valid Mermaid syntax starting with "graph LR". Always include this field in your JSON response — the dashboard will render it as a mermaid widget.',
  };

  if (existingTopoComposite) {
    await prisma.skill.update({
      where: { id: existingTopoComposite.id },
      data: {
        name: topoCompositeRecord.name,
        description: topoCompositeRecord.description,
        capabilities: topoCompositeRecord.capabilities,
        systemPrompt: topoCompositeRecord.systemPrompt,
        tools: topoCompositeRecord.tools as any,
        learnedNotes: topoCompositeRecord.learnedNotes,
      },
    });
    topoCompositeId = existingTopoComposite.id;
  } else {
    const created = await prisma.skill.create({ data: topoCompositeRecord as any });
    topoCompositeId = created.id;
  }
  ok(`XCO Composite skill: ${topoCompositeId}`);


  log('Seeding learnedNotes for XCO skills...');
  const learnedNotesMap: Record<string, string> = {
    'networking.extreme-xco.monitor':
      'API base is /v1 (NOT /rest/v1). All calls go through HTTPS port 443. Start every XCO session with xco_get_inventory to enumerate switches and fabrics. For alarm triage use xco_get_alarm_summary first (gives counts by severity), then xco_get_alarm_inventory for details.',
    'networking.extreme-xco.diagnostics':
      'For BGP troubleshooting: xco_get_bgp_sessions → identify DOWN peers → xco_get_interface_status for that switch → xco_get_lldp_neighbors to confirm physical connectivity. If interface UP + BGP DOWN → config mismatch. If interface DOWN → physical/optic issue. Always correlate with xco_get_alarm_inventory.',
    'networking.extreme-xco.telemetry':
      'Device telemetry requires the switch management IP as ip_address parameter. Get IPs from xco_get_inventory first. xco_get_interface_utilization gives per-port traffic rates; xco_get_fabric_utilization gives aggregate east-west summary across the fabric.',
    'networking.extreme-xco.operations':
      'All write operations (ack/close alarms, push config) require human approval per the agent charter. Always describe the change first and confirm before executing. After config push, verify with xco_get_fabric_health to confirm no new errors.',
  };
  try {
    for (const [domain, note] of Object.entries(learnedNotesMap)) {
      const skill = await prisma.skill.findFirst({ where: { domain } });
      if (skill) {
        await prisma.skill.update({ where: { id: skill.id }, data: { learnedNotes: note } });
        ok(`learnedNotes set: ${domain}`);
      } else {
        info(`Skill not found for learnedNotes: ${domain}`);
      }
    }
  } catch (e) {
    info(`learnedNotes seeding skipped: ${(e as Error).message}`);
  }

  // ── 5. Create agents ────────────────────────────────────────────────────────
  log('Creating XCO Monitor Agent (AUTONOMOUS, read-only)...');
  const monitorCharter = await prisma.agentCharter.create({
    data: {
      mandate: 'Monitor ExtremeCloud Orchestrator fabric health. Collect alarm data, fabric topology, device inventory and platform health. Flag Critical/Major issues immediately. Never write.',
      posture: 'AUTONOMOUS',
      bearing: 'ANALYTICAL',
      verbosity: 'STANDARD',
      conductBoundaries: ['write:*', 'delete:*'],
      escalationTriggers: ['Critical alarm', 'fabric provisioning failed', 'service unhealthy', 'configuration drift'],
    },
  });

  const monitorAgent = await prisma.agent.create({
    data: {
      name: 'XCO Monitor',
      description: 'Autonomous read-only agent for monitoring XCO fabrics, alarms, devices, platform health, BGP/interface diagnostics, and telemetry.',
      llmProvider: LLM_PROVIDER,
      llmModel: LLM_MODEL,
      permissions: ['read:data', 'read:metrics'],
      status: 'ACTIVE',
      ownerId: systemUser.id,
      charterId: monitorCharter.id,
      credentialId: agentCredId,
      agentSkills: {
        create: [
          { skillId: monitorSkill.id },
          { skillId: diagnosticsSkill.id },
          { skillId: telemetrySkill.id },
          { skillId: topoCompositeId },
        ],
      },
    },
  });
  ok(`XCO Monitor agent: ${monitorAgent.id}`);

  log('Creating XCO Operator Agent (SUPERVISED)...');
  const operatorCharter = await prisma.agentCharter.create({
    data: {
      mandate: 'Operate ExtremeCloud Orchestrator. Read all data autonomously. For alarm ack/close/fabric ops, request approval. Never provision or delete without explicit instruction.',
      posture: 'SUPERVISED',
      bearing: 'FORMAL',
      verbosity: 'DETAILED',
      conductBoundaries: ['fabric.create', 'fabric.delete', 'device.register', 'device.remove', 'alarm.purge'],
      escalationTriggers: ['Critical alarm unacknowledged', 'fabric provisioning failed', 'multiple devices offline'],
    },
  });

  const operatorAgent = await prisma.agent.create({
    data: {
      name: 'XCO Operator',
      description: 'Supervised operator for XCO. Reads freely (inventory, alarms, BGP/interface diagnostics, telemetry), writes require approval.',
      llmProvider: LLM_PROVIDER,
      llmModel: LLM_MODEL,
      permissions: ['read:data', 'read:metrics', 'write:alarms'],
      status: 'ACTIVE',
      ownerId: systemUser.id,
      charterId: operatorCharter.id,
      credentialId: agentCredId,
      agentSkills: {
        create: [
          { skillId: monitorSkill.id },
          { skillId: opsSkill.id },
          { skillId: diagnosticsSkill.id },
          { skillId: telemetrySkill.id },
          { skillId: topoCompositeId },
        ],
      },
    },
  });
  ok(`XCO Operator agent: ${operatorAgent.id}`);

  // ── 6. Target for XCO host ──────────────────────────────────────────────────
  log('Creating XCO target (for SSH exec)...');
  const existingTarget = await prisma.target.findFirst({ where: { hostname: XCO_HOST } });
  if (!existingTarget) {
    const sshCredName = 'system.xco_ssh';
    let sshCredId = (await prisma.credential.findFirst({ where: { name: sshCredName } }))?.id;
    if (!sshCredId) {
      const sshCred = await vault.create({
        name: sshCredName,
        scope: 'SYSTEM',
        credentialType: 'SSH_KEY',
        value: { host: XCO_HOST, username: XCO_USERNAME, password: XCO_PASSWORD },
        allowedAgentPermissions: ['ssh:exec', 'read:data'],
      });
      sshCredId = sshCred.id;
    }
    await prisma.target.create({
      data: {
        name: `XCO (${XCO_HOST})`,
        hostname: XCO_HOST,
        sshPort: 22,
        credentialId: sshCredId,
        description: 'ExtremeCloud Orchestrator management node',
        apiBaseUrl: XCO_BASE_URL,
        tags: ['xco', 'orchestrator'],
      },
    });
    ok(`Created target: XCO (${XCO_HOST})`);
  } else {
    ok(`Target already exists: ${existingTarget.id}`);
  }

  // ── 7. Push to registry ─────────────────────────────────────────────────────
  log('Pushing skills to registry...');
  for (const skill of [monitorSkill, opsSkill, diagnosticsSkill, telemetrySkill, { ...topoCompositeRecord, id: topoCompositeId }]) {    try {
      const { fetch } = await import('undici');
      const res = await fetch(`${REGISTRY_URL}/registry/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REGISTRY_TOKEN}` },
        body: JSON.stringify({
          domain: skill.domain,
          name: skill.name,
          version: skill.version,
          description: skill.description,
          capabilities: skill.capabilities,
          systemPrompt: skill.systemPrompt,
          tools: skill.tools,
        }),
      });
      if (res.ok) ok(`Registry: ${skill.domain}`);
      else info(`Registry skipped (${res.status}) for ${skill.domain}`);
    } catch {
      info(`Registry unreachable — ${skill.domain} available locally`);
    }
  }

  // ── 8. Summary ──────────────────────────────────────────────────────────────
  log('');
  log('══════════════════════════════════════════════');
  log('  XCO SEED COMPLETE');
  log('══════════════════════════════════════════════');
  console.log('');
  console.log('  XCO Host:   ', XCO_HOST);
  console.log('  Base URL:   ', XCO_BASE_URL);
  console.log('  Auth URL:   ', XCO_AUTH_URL);
  console.log('');
  console.log('  Skills (PUBLISHED):');
  console.log(`    networking.extreme-xco.monitor       ${monitorSkill.id}  (${MONITOR_TOOLS.length} tools)`);
  console.log(`    networking.extreme-xco.operations    ${opsSkill.id}  (${OPERATIONS_TOOLS.length} tools)`);
  console.log(`    networking.extreme-xco.diagnostics   ${diagnosticsSkill.id}  (${DIAGNOSTIC_TOOLS.length} tools)`);
  console.log(`    networking.extreme-xco.telemetry     ${telemetrySkill.id}  (${TELEMETRY_TOOLS.length} tools)`);
  console.log('');
  console.log('  Agents (ACTIVE):');
  console.log(`    XCO Monitor   ${monitorAgent.id}  (AUTONOMOUS)`);
  console.log(`    XCO Operator  ${operatorAgent.id}  (SUPERVISED)`);
  console.log('');
  console.log('  Test with:');
  console.log(`    POST /requests  { agentId: "${monitorAgent.id}", input: "List all devices on this XCO network" }`);
  console.log('');

  // Write output file
  const xcoBaseUrlResolved = XCO_HOST ? `https://${XCO_HOST}/v1` : XCO_BASE_URL;
  const output = {
    xcoHost: XCO_HOST,
    xcoBaseUrl: xcoBaseUrlResolved,
    credentials: { system: credId, agent: agentCredId },
    skills: {
      monitor:     { id: monitorSkill.id,     domain: monitorSkill.domain },
      operations:  { id: opsSkill.id,         domain: opsSkill.domain },
      diagnostics: { id: diagnosticsSkill.id, domain: diagnosticsSkill.domain },
      telemetry:   { id: telemetrySkill.id,   domain: telemetrySkill.domain },
    },
    agents: {
      monitor: monitorAgent.id,
      operator: operatorAgent.id,
    },
  };

  const outputDir = resolve(process.cwd(), 'logs', 'xco');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'setup-output.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  ok(`Output written to ${outputPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[XCO-SEED] Fatal:', e);
  process.exit(1);
});
