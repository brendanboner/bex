/**
 * Default agent + persona provisioning.
 *
 * Called once at api-gateway startup (after loadSystemSecrets). Idempotent —
 * checks for existing records before creating. This ensures agents and personas
 * are always present after a DB reset, fresh install, or credential update via
 * the dashboard GUI.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { CredentialVaultService } from '@bex/credential-vault';
import { SkillRegistryClient } from '@bex/skill-registry-client';
import { KnowledgeStore } from '@bex/knowledge-store';
import { createHash } from 'crypto';
import { seedDomainIntelligence } from '../../../scripts/seed-domain-intelligence.js';

const XIQ_SKILL_DOMAINS = [
  'extremecloudiq.networking',
  'extremecloudiq.devices',
  'extremecloudiq.clients',
  'extremecloudiq.monitoring',
  'extremecloudiq.alerts.logs',
  'extremecloudiq.network.policy',
  'extremecloudiq.network.config',
  'extremecloudiq.network.auth',
  'extremecloudiq.location',
  'extremecloudiq.wireless',
  'extremecloudiq.topology',
  'extremecloudiq.composite',
] as const;

const XCO_SKILL_DOMAINS = [
  'networking.extreme-xco.monitor',
  'networking.extreme-xco.operations',
  'networking.extreme-xco.diagnostics',
  'networking.extreme-xco.telemetry',
] as const;

/**
 * Attempt to pull a skill from the remote registry and upsert it locally.
 * Returns the skill id on success, null on any error (non-blocking).
 */
async function tryPullFromRegistry(
  prisma: PrismaClient,
  client: SkillRegistryClient,
  domain: string,
  version = '1.0.0',
): Promise<string | null> {
  try {
    const manifest = await client.fetch(domain, version);
    if (!client.verify(manifest)) return null;
    const skill = await prisma.skill.upsert({
      where: { domain_version: { domain: manifest.domain, version: manifest.version } },
      create: {
        name: manifest.name,
        domain: manifest.domain,
        version: manifest.version,
        description: manifest.description ?? null,
        capabilities: manifest.capabilities ?? [],
        tools: manifest.tools as Prisma.InputJsonValue,
        systemPrompt: manifest.systemPrompt ?? null,
        status: 'PUBLISHED',
      },
      update: {
        name: manifest.name,
        description: manifest.description ?? null,
        tools: manifest.tools as Prisma.InputJsonValue,
        systemPrompt: manifest.systemPrompt ?? null,
        capabilities: manifest.capabilities ?? [],
        status: 'PUBLISHED',
      },
    });
    return skill.id;
  } catch {
    return null;
  }
}

async function credentialExists(prisma: PrismaClient, name: string): Promise<boolean> {
  const cred = await prisma.credential.findFirst({ where: { name, scope: 'SYSTEM' }, select: { id: true } });
  return cred !== null;
}

async function agentExists(prisma: PrismaClient, ...names: string[]): Promise<boolean> {
  const agent = await prisma.agent.findFirst({ where: { name: { in: names } }, select: { id: true } });
  return agent !== null;
}

async function ensureSkillsInstalled(
  prisma: PrismaClient,
  domainPrefix: string,
  domains: readonly string[],
  label: string,
  createLocally?: (prisma: PrismaClient) => Promise<boolean>,
): Promise<boolean> {
  const existing = await prisma.skill.findFirst({
    where: { domain: { startsWith: domainPrefix } },
    select: { id: true },
  });
  if (existing) return true;

  // Skills absent — try registry pull
  const client = new SkillRegistryClient();
  const ids: string[] = [];
  for (const domain of domains) {
    const id = await tryPullFromRegistry(prisma, client, domain);
    if (id) ids.push(id);
  }

  if (ids.length > 0) {
    console.info(`[provision] Installed ${ids.length} ${label} skill(s) from registry`);
    return true;
  }

  // Registry unavailable or empty — fall back to local creation
  if (createLocally) {
    try {
      const created = await createLocally(prisma);
      if (created) {
        console.info(`[provision] Created ${label} skill(s) locally (registry unavailable)`);
        return true;
      }
    } catch (e) {
      console.warn(`[provision] Local ${label} skill creation failed:`, (e as Error).message);
    }
  }

  console.info(`[provision] ${label} skills not available — run: bex skill build`);
  return false;
}

// ─── XCO skill definitions (local fallback) ──────────────────────────────────

const XCO_BASE_URL = 'https://{xco-host}/v1';
const XCO_AUTH_URL = 'https://{xco-host}/v1/auth/token/access-token';

function makeXcoTool(
  name: string,
  description: string,
  method: string,
  urlPath: string,
  params: Record<string, { type: string; description: string }> = {},
  isWrite = false,
) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [k, v] of Object.entries(params)) properties[k] = { type: v.type, description: v.description };
  return {
    name,
    description: `[${method}] ${description}${isWrite ? ' ⚠️ WRITE — requires approval' : ''}`,
    handlerType: 'xco_http_call',
    config: { method, urlTemplate: `${XCO_BASE_URL}${urlPath}`, authUrl: XCO_AUTH_URL, isWrite, operationId: name },
    parameters: { type: 'object' as const, properties, required: [] as string[] },
  };
}

async function createXcoSkillsLocally(prisma: PrismaClient): Promise<boolean> {
  const monitorTools = [
    makeXcoTool('xco_get_inventory', 'List all registered switches/devices in XCO inventory (optionally filtered by fabric)', 'GET', '/inventory/switches',
      { fabric_name: { type: 'string', description: 'Filter by fabric name (optional)' } }),
    makeXcoTool('xco_get_switch_config', 'Get configuration and settings for a specific switch', 'GET', '/inventory/switchconfig/setting',
      { ip_address: { type: 'string', description: 'Management IP address of the switch (required)' } }),
    makeXcoTool('xco_get_rma_history', 'Get device RMA history', 'GET', '/inventory/rma-history'),
    makeXcoTool('xco_get_alarm_summary', 'Get alarm counts grouped by severity (Critical/Major/Minor/Warning/Info)', 'GET', '/faultmanager/alarm/summary'),
    makeXcoTool('xco_get_alarm_inventory', 'List all currently active alarms', 'GET', '/faultmanager/alarm/inventory', {
      severity:  { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      page_size: { type: 'integer', description: 'Page size (default 20)' } as unknown as { type: string; description: string },
    }),
    makeXcoTool('xco_get_alarm_history', 'Get historical alarm records with optional filters', 'GET', '/faultmanager/alarm/history', {
      severity:  { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      unacked:   { type: 'boolean', description: 'Only unacknowledged alarms' } as unknown as { type: string; description: string },
      cleared:   { type: 'boolean', description: 'Include cleared alarms (default false)' } as unknown as { type: string; description: string },
      page_size: { type: 'integer', description: 'Page size (default 20)' } as unknown as { type: string; description: string },
      sort_by:   { type: 'string', description: 'Sort direction: asc or desc' },
    }),
    makeXcoTool('xco_get_alert_inventory', 'List all currently active alerts', 'GET', '/faultmanager/alert/inventory', {
      severity: { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
    }),
    makeXcoTool('xco_get_alert_history', 'Get historical alert records', 'GET', '/faultmanager/alert/history', {
      severity: { type: 'string', description: 'Filter: Critical, Major, Minor, Warning, Info' },
      limit:    { type: 'integer', description: 'Max results (default 50)' } as unknown as { type: string; description: string },
    }),
    makeXcoTool('xco_get_fabrics', 'List all IP fabrics with status and device counts', 'GET', '/fabric/fabrics'),
    makeXcoTool('xco_get_fabric_detail', 'Get detailed information for a specific fabric', 'GET', '/fabric/fabric', {
      name:   { type: 'string', description: 'Name of the fabric to retrieve (required)' },
      detail: { type: 'boolean', description: 'Return full detail including node counts' } as unknown as { type: string; description: string },
    }),
    makeXcoTool('xco_get_fabric_health', 'Get health status for all fabrics (or a specific one)', 'GET', '/fabric/fabrics-health',
      { 'fabric-name': { type: 'string', description: 'Filter to a specific fabric (optional)' } }),
    makeXcoTool('xco_get_fabric_errors', 'Get fabric configuration errors across all fabrics (or a specific one)', 'GET', '/fabric/fabrics/errors',
      { 'fabric-name': { type: 'string', description: 'Filter to a specific fabric name (optional)' } }),
    makeXcoTool('xco_validate_fabric', 'Validate CLOS topology — find missing links, drift, redundant links', 'GET', '/fabric/validate',
      { 'fabric-name': { type: 'string', description: 'Name of the fabric to validate (required)' } }),
    makeXcoTool('xco_get_system_settings', 'Get XCO platform-wide system settings', 'GET', '/system/settings'),
    makeXcoTool('xco_get_system_feature', 'Get XCO feature flags and platform health status', 'GET', '/system/feature'),
    makeXcoTool('xco_get_rbac_roles', 'List all RBAC roles defined in XCO', 'GET', '/rbac/roles'),
    makeXcoTool('xco_get_tenants', 'List all tenants (VRF / tenant network groupings) in XCO', 'GET', '/tenant/tenants'),
    makeXcoTool('xco_get_notification_subscribers', 'List all notification subscribers configured in XCO', 'GET', '/notification/subscribers'),
    makeXcoTool('xco_get_snmp_subscribers', 'List all SNMP trap subscribers configured in XCO', 'GET', '/snmp/subscribers'),
  ];

  const operationsTools = [
    makeXcoTool('xco_ack_alarms', 'Acknowledge active alarms by instance_id range', 'PUT', '/faultmanager/alarm/acknowledge', {
      instance_id: { type: 'string', description: 'Alarm instance IDs — comma-separated or range e.g. 2,3,5-10' },
      resource:    { type: 'string', description: 'Resource path filter (optional)' },
      comment:     { type: 'string', description: 'Comment explaining the acknowledgement' },
    }, true),
    makeXcoTool('xco_close_alarms', 'Close raised or cleared alarms by instance_id', 'PUT', '/faultmanager/alarm/close', {
      instance_id: { type: 'string', description: 'Alarm instance IDs — comma-separated or range' },
      resource:    { type: 'string', description: 'Resource path filter (optional)' },
      comment:     { type: 'string', description: 'Comment explaining the closure' },
    }, true),
    makeXcoTool('xco_purge_alarms', 'Purge ALL closed alarms — IRREVERSIBLE', 'DELETE', '/faultmanager/alarm/purge', {}, true),
    makeXcoTool('xco_create_fabric', 'Create a new IP Fabric (CLOS or non-CLOS)', 'POST', '/fabric/fabric', {
      name:        { type: 'string', description: 'Fabric name (e.g. PROD-DC1)' },
      description: { type: 'string', description: 'Fabric description' },
      stage:       { type: 'integer', description: 'CLOS stage: 3, 5, or 7' } as unknown as { type: string; description: string },
      type:        { type: 'string', description: 'Fabric type: clos or non-clos' },
    }, true),
    makeXcoTool('xco_delete_fabric', 'Delete an existing fabric and all its configuration', 'DELETE', '/fabric/fabric', {
      name:  { type: 'string', description: 'Fabric name to delete' },
      force: { type: 'boolean', description: 'Force delete even with registered devices' } as unknown as { type: string; description: string },
    }, true),
    makeXcoTool('xco_register_device', 'Register a new switch/device to XCO inventory', 'POST', '/inventory/switch', {
      ip_address: { type: 'string', description: 'Management IP address of the switch' },
      username:   { type: 'string', description: 'Switch admin username' },
      password:   { type: 'string', description: 'Switch admin password' },
      fabric:     { type: 'string', description: 'Fabric name to register to' },
    }, true),
    makeXcoTool('xco_remove_device', 'Remove a device from XCO inventory', 'DELETE', '/inventory/switch',
      { ip_address: { type: 'string', description: 'IP address of the device to remove' } }, true),
    makeXcoTool('xco_update_device_setting', 'Update a switch configuration setting (e.g. maintenance_mode_on_reboot)', 'PUT', '/inventory/switchconfig/setting', {
      ip_address: { type: 'string', description: 'Management IP address of the switch' },
      key:        { type: 'string', description: 'Setting key (e.g. maintenance_mode_on_reboot)' },
      value:      { type: 'string', description: 'Setting value (e.g. Yes or No)' },
    }, true),
  ];

  await prisma.skill.createMany({
    data: [
      {
        name: 'ExtremeCloud Orchestrator — Monitor',
        domain: 'networking.extreme-xco.monitor',
        version: '1.0.0',
        description: 'Read-only monitoring for XCO: device inventory, fabric health, alarms, topology validation, platform health.',
        capabilities: ['inventory', 'alarms', 'fabric-health', 'topology-validation', 'system-health'],
        tools: monitorTools as unknown as import('@prisma/client').Prisma.InputJsonValue,
        systemPrompt: 'You are a read-only XCO monitoring agent. Use the available tools to retrieve device inventory, alarm summaries, fabric health, and platform status. Never perform write operations. When the request mentions "dashboard", "JSON", "structured data", or "export": respond with a single JSON object only — no markdown, no prose. Use snake_case keys. Arrays of objects should have consistent flat keys.',
        status: 'PUBLISHED',
      },
      {
        name: 'ExtremeCloud Orchestrator — Operations',
        domain: 'networking.extreme-xco.operations',
        version: '1.0.0',
        description: 'Write operations for XCO: alarm management, fabric lifecycle, device registration.',
        capabilities: ['alarm-management', 'fabric-lifecycle', 'device-registration'],
        tools: operationsTools as unknown as import('@prisma/client').Prisma.InputJsonValue,
        systemPrompt: 'You are an XCO operations agent. All write operations (acknowledge/close alarms, create/delete fabrics, register devices) require explicit user approval before executing.',
        status: 'PUBLISHED',
      },
    ],
    skipDuplicates: true,
  });

  return true;
}

async function provisionXiqAgent(prisma: PrismaClient): Promise<boolean> {
  const skillsReady = await ensureSkillsInstalled(prisma, 'extremecloudiq.', XIQ_SKILL_DOMAINS, 'ExtremeCloud IQ');
  if (!skillsReady) return false;

  const xiqSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'extremecloudiq.' } },
    select: { id: true, domain: true },
  });

  // seed-xciq-full.ts creates "ExtremeCloud IQ Monitor"; init.ts creates "ExtremeCloud IQ"
  if (await agentExists(prisma, 'ExtremeCloud IQ', 'ExtremeCloud IQ Monitor')) {
    return true;
  }

  // Provision runs as system user
  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!systemUser) {
    // System user is created by bex init — if it doesn't exist yet, skip silently
    return false;
  }

  console.info(`[provision] Creating ExtremeCloud IQ agent with ${xiqSkills.length} skill(s)…`);
  const agent = await prisma.agent.create({
    data: {
      name: 'ExtremeCloud IQ',
      description: 'Manages and monitors your ExtremeCloud IQ wireless network — devices, clients, alerts, policies, and more.',
      llmProvider: process.env['LLM_PROVIDER'] ?? 'openai',
      llmModel: process.env['LLM_MODEL'] ?? 'gpt-4o',
      permissions: ['xiq:read', 'xiq:write'],
      ownerId: systemUser.id,
      persona: {
        systemPrompt: `You are a comprehensive ExtremeCloud IQ network assistant.

You can: list and monitor devices, view client connections, check alerts and logs, manage network policies, and more.

IMPORTANT: For any write operation (create, update, delete, push config), always:
1. Describe exactly what will change
2. Ask for explicit confirmation before proceeding
3. Report the outcome clearly

Be concise and clear in your responses.`,
      },
      agentSkills: {
        create: xiqSkills.map((s) => ({ skillId: s.id })),
      },
    },
  });

  const charter = await prisma.agentCharter.create({
    data: {
      mandate: 'Manage and monitor ExtremeCloud IQ. Read operations are autonomous. Write operations require human approval.',
      posture: 'SUPERVISED',
      conductBoundaries: ['delete:*', 'push:config'],
      bearing: 'ANALYTICAL',
      verbosity: 'STANDARD',
    },
  });
  await prisma.agent.update({ where: { id: agent.id }, data: { charterId: charter.id } });

  console.info(`[provision] ExtremeCloud IQ agent created: ${agent.id}`);

  // Seed domain intelligence playbooks (idempotent)
  try {
    await seedDomainIntelligence(prisma);
    console.info('[provision] Domain intelligence playbooks seeded');
  } catch (e) {
    console.warn('[provision] Domain intelligence seeding failed (non-fatal):', (e as Error).message);
  }

  return true;
}

async function provisionXcoAgent(prisma: PrismaClient): Promise<boolean> {
  const skillsReady = await ensureSkillsInstalled(prisma, 'networking.extreme-xco.', XCO_SKILL_DOMAINS, 'ExtremeCloud Orchestrator', createXcoSkillsLocally);
  if (!skillsReady) return false;

  const xcoSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'networking.extreme-xco.' } },
    select: { id: true, domain: true },
  });
  if (xcoSkills.length === 0) {
    // ensureSkillsInstalled already logged a message — just return
    return false;
  }

  // setup-xco.js creates "XCO Monitor/Operator/Provisioner"; init.ts creates "ExtremeCloud Orchestrator"
  if (await agentExists(prisma, 'ExtremeCloud Orchestrator', 'XCO Monitor', 'XCO Operator', 'XCO Provisioner')) {
    return true;
  }

  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!systemUser) {
    return false;
  }

  console.info(`[provision] Creating ExtremeCloud Orchestrator agent with ${xcoSkills.length} skill(s)…`);
  const agent = await prisma.agent.create({
    data: {
      name: 'ExtremeCloud Orchestrator',
      description: 'Monitors and manages your ExtremeCloud Orchestrator fabric network — health, alarms, topology, and operations.',
      llmProvider: process.env['LLM_PROVIDER'] ?? 'openai',
      llmModel: process.env['LLM_MODEL'] ?? 'gpt-4o',
      permissions: ['xco:read', 'xco:write'],
      ownerId: systemUser.id,
      persona: {
        systemPrompt: `You are an ExtremeCloud Orchestrator (XCO) network agent.

You can: monitor fabric health and topology, retrieve alarms, check device inventory, validate CLOS topology, detect configuration drift.

Write operations (fabric creation, switch management, alarm management) require explicit approval.

Be concise and technical in your responses.`,
      },
      agentSkills: {
        create: xcoSkills.map((s) => ({ skillId: s.id })),
      },
    },
  });

  const charter = await prisma.agentCharter.create({
    data: {
      mandate: 'Monitor and manage ExtremeCloud Orchestrator. Read operations are autonomous. Write operations require approval.',
      posture: 'SUPERVISED',
      conductBoundaries: ['delete:*', 'fabric:reset', 'switch:remove'],
      bearing: 'ANALYTICAL',
      verbosity: 'STANDARD',
    },
  });
  await prisma.agent.update({ where: { id: agent.id }, data: { charterId: charter.id } });

  console.info(`[provision] ExtremeCloud Orchestrator agent created: ${agent.id}`);
  return true;
}

async function provisionNetOpsPersona(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.persona.findFirst({
    where: { name: 'Network Operations Manager' },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  await prisma.persona.create({
    data: {
      name: 'Network Operations Manager',
      goal: 'Monitor and manage the network estate: XIQ wireless infrastructure and XCO fabric. Detect anomalies, surface alerts, and orchestrate remediation.',
      domain: 'networking',
      systemPrompt: `You are the Network Operations Manager — a senior-level network intelligence agent.

Your responsibilities:
- Monitor ExtremeCloud IQ wireless infrastructure (APs, clients, alerts, policies)
- Monitor ExtremeCloud Orchestrator fabric (topology, alarms, drift)
- Surface anomalies and prioritise incidents by severity
- Suggest and orchestrate remediation actions with appropriate approval gates
- Provide clear, actionable status summaries

Operating posture:
- All read/query operations: execute autonomously
- Configuration changes, policy pushes, device reboots: always seek approval first
- Critical incidents: escalate immediately with full context

When asked for a network status summary, check both XIQ and XCO if both are configured.`,
      requiredSkills: ['extremecloudiq.networking', 'extremecloudiq.monitoring', 'extremecloudiq.alerts.logs', 'networking.extreme-xco.monitor'],
      suggestedPermissions: ['xiq:read', 'xiq:write', 'xco:read', 'xco:write'],
      tags: ['networking', 'operations', 'xiq', 'xco', 'monitoring'],
    },
  });
  console.info('[provision] Network Operations Manager persona created');
}

async function provisionDefaultLLMConfig(prisma: PrismaClient, vault: CredentialVaultService): Promise<void> {
  const count = await prisma.lLMConfig.count();
  if (count > 0) return; // already has configs — nothing to do

  const provider = process.env['LLM_PROVIDER'];
  const model = process.env['LLM_MODEL'];
  if (!provider || !model) return;

  // Find the credential created by bex init (bex.llm.primary or system.*_api_key)
  const credNames = [`bex.llm.primary`, `system.${provider}_api_key`, `system.openai_api_key`];
  const cred = await prisma.credential.findFirst({
    where: { name: { in: credNames } },
    select: { id: true },
  });

  const configName = `${provider.charAt(0).toUpperCase() + provider.slice(1)} (system)`;
  await prisma.lLMConfig.create({
    data: {
      name: configName,
      provider,
      model,
      isDefault: true,
      ...(cred ? { credentialId: cred.id } : {}),
      ...(provider === 'ollama' && process.env['OLLAMA_BASE_URL']
        ? { baseUrl: process.env['OLLAMA_BASE_URL'] }
        : {}),
    },
  });
  console.info(`[provision] Created default LLM config: ${provider}/${model}`);
}

async function publishSkillsByDomainPrefix(prisma: PrismaClient, prefix: string): Promise<void> {
  const updated = await prisma.skill.updateMany({
    where: { domain: { startsWith: prefix }, status: 'DRAFT' },
    data: { status: 'PUBLISHED' },
  });
  if (updated.count > 0) {
    console.info(`[provision] Auto-published ${updated.count} skill(s) with domain prefix '${prefix}'`);
  }
}

async function syncKnowledgeFromRegistry(): Promise<void> {
  const knowledgeDir = process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge';
  const store = new KnowledgeStore(knowledgeDir);
  const client = new SkillRegistryClient();
  if (!client.isConfigured) return;

  let entries: Awaited<ReturnType<typeof client.listKnowledge>>;
  try {
    entries = await client.listKnowledge();
  } catch {
    return; // registry unreachable — skip silently
  }

  let synced = 0;
  for (const meta of entries) {
    // Skip agent-scoped knowledge (agent/* is local only)
    if (meta.domain === 'agent') continue;

    const existing = await store.read(meta.domain, meta.topic);
    if (existing) {
      // Skip if content matches checksum
      const localChecksum = createHash('sha256').update(existing.content).digest('hex');
      if (localChecksum === meta.checksum) continue;
    }

    try {
      const manifest = await client.fetchKnowledge(meta.domain, meta.topic);
      await store.write(meta.domain, meta.topic, manifest.content);
      synced++;
      console.info(`[provision] Synced knowledge: ${meta.domain}/${meta.topic}`);
    } catch (e) {
      console.warn(`[provision] Failed to sync knowledge ${meta.domain}/${meta.topic}:`, (e as Error).message);
    }
  }

  if (synced > 0) {
    console.info(`[provision] Knowledge sync complete — ${synced} file(s) updated`);
  }
}

export async function provisionDefaults(prisma: PrismaClient, vault: CredentialVaultService): Promise<void> {
  try {
    await provisionDefaultLLMConfig(prisma, vault);

    const hasXiq = await credentialExists(prisma, 'system.xiq_credentials');
    const hasXco = await credentialExists(prisma, 'system.xco_credentials');

    // Also check env flags set by bex init for cold-boot awareness
    const xiqEnabled = hasXiq || process.env['BEX_XIQ_ENABLED'] === 'true';
    const xcoEnabled = hasXco || process.env['BEX_XCO_ENABLED'] === 'true';

    let anyProvisioned = false;

    if (xiqEnabled) {
      const ok = await provisionXiqAgent(prisma);
      if (ok) anyProvisioned = true;
      // Auto-publish XIQ skills so they appear in the skill exchange
      await publishSkillsByDomainPrefix(prisma, 'extremecloudiq.');
    }

    if (xcoEnabled) {
      const ok = await provisionXcoAgent(prisma);
      if (ok) anyProvisioned = true;
      // Auto-publish XCO skills so they appear in the skill exchange
      await publishSkillsByDomainPrefix(prisma, 'networking.extreme-xco.');
    }

    if (anyProvisioned || (xiqEnabled || xcoEnabled)) {
      await provisionNetOpsPersona(prisma);
    }

    await provisionSystemOpsSkill(prisma);
    await assignSystemOpsSkillToMonitorAgents(prisma);
    await provisionApSsidMonitorJob(prisma);
    await syncKnowledgeFromRegistry();
  } catch (e) {
    // Provisioning failures must never block startup
    console.error('[provision] Error during default provisioning:', (e as Error).message);
  }
}

async function provisionSystemOpsSkill(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.skill.findFirst({
    where: { domain: 'system.operations' },
    select: { id: true },
  });
  if (existing) return;

  console.info('[provision] Creating system.operations skill…');

  const tools = [
    {
      name: 'list_scheduled_jobs',
      description: 'List all scheduled jobs, their names, enabled status, cron schedule, and last run time. Use this to see what monitoring jobs exist.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/scheduled-jobs', method: 'GET' },
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_scheduled_job',
      description: 'Get details of a specific scheduled job by ID.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/scheduled-jobs/{id}', method: 'GET' },
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Scheduled job ID' } },
        required: ['id'],
      },
    },
    {
      name: 'enable_scheduled_job',
      description: 'Enable (start) a scheduled job by its ID so it runs on its cron schedule.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/scheduled-jobs/{id}', method: 'PATCH' },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Scheduled job ID' },
          enabled: { type: 'boolean', description: 'Set to true to enable', enum: [true] },
        },
        required: ['id', 'enabled'],
      },
    },
    {
      name: 'disable_scheduled_job',
      description: 'Disable (stop/pause) a scheduled job by its ID. The job will not run until re-enabled.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/scheduled-jobs/{id}', method: 'PATCH' },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Scheduled job ID' },
          enabled: { type: 'boolean', description: 'Set to false to disable', enum: [false] },
        },
        required: ['id', 'enabled'],
      },
    },
    {
      name: 'trigger_scheduled_job',
      description: 'Immediately trigger a scheduled job to run now, regardless of its cron schedule.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/scheduled-jobs/{id}/run-now', method: 'POST' },
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Scheduled job ID' } },
        required: ['id'],
      },
    },
    {
      name: 'list_agents',
      description: 'List all agents in the system with their status, skills, and schedule information.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/agents', method: 'GET' },
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_personas',
      description: 'List all personas (agent blueprints/identities) in the system.',
      handlerType: 'bex_api_call',
      config: { urlPath: '/personas', method: 'GET' },
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ];

  await prisma.skill.create({
    data: {
      name: 'System Operations',
      domain: 'system.operations',
      version: '1.0.0',
      description: 'Control BEX system internals — list, enable, disable, and trigger scheduled jobs; list agents and personas.',
      capabilities: ['list-jobs', 'enable-job', 'disable-job', 'trigger-job', 'list-agents', 'list-personas'],
      tools: tools as unknown as import('@prisma/client').Prisma.InputJsonValue,
      systemPrompt:
        'You have tools to manage the BEX agentic system. When the user asks to start/stop a schedule or monitor, ' +
        'first list_scheduled_jobs to find the right job ID, then enable or disable it. ' +
        'When triggering jobs, confirm success with the returned requestId. ' +
        'Be concise — show job name, status, and schedule in your response.',
      status: 'PUBLISHED',
    },
  });

  console.info('[provision] system.operations skill created');
}

async function assignSystemOpsSkillToMonitorAgents(prisma: PrismaClient): Promise<void> {
  const sysOps = await prisma.skill.findFirst({
    where: { domain: 'system.operations' },
    select: { id: true },
  });
  if (!sysOps) return;

  // Find all monitoring agents and assign system ops skill
  const monitorAgents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: 'Monitor' } },
        { name: { contains: 'Operator' } },
      ],
    },
    select: { id: true, name: true },
  });

  for (const agent of monitorAgents) {
    const existing = await prisma.agentSkill.findUnique({
      where: { agentId_skillId: { agentId: agent.id, skillId: sysOps.id } },
    });
    if (!existing) {
      await prisma.agentSkill.create({ data: { agentId: agent.id, skillId: sysOps.id } });
      console.info(`[provision] Assigned system.operations to ${agent.name}`);
    }
  }
}

async function provisionApSsidMonitorJob(prisma: PrismaClient): Promise<void> {
  // Check if AP/SSID monitor job already exists
  const existing = await prisma.scheduledJob.findFirst({
    where: { name: { contains: 'AP/SSID Client Monitor' } },
    select: { id: true },
  });
  if (existing) return;

  // Find the XIQ Monitor agent
  const agent = await prisma.agent.findFirst({
    where: { name: { in: ['ExtremeCloud IQ Monitor', 'ExtremeCloud IQ'] } },
    select: { id: true, name: true },
  });
  if (!agent) {
    console.info('[provision] No XIQ agent found — skipping AP/SSID monitor job');
    return;
  }

  await prisma.scheduledJob.create({
    data: {
      name: 'AP/SSID Client Monitor (15 min)',
      description: 'Counts clients per Access Point and SSID every 15 minutes.',
      agentId: agent.id,
      cronExpr: '*/15 * * * *',
      input:
        'Count clients on each Access Point and SSID. ' +
        'For each AP, list: AP Name | SSID | Client Count | Device Types summary. ' +
        'Be concise. If there are 0 clients, say so briefly.',
      enabled: true,
    },
  });

  console.info(`[provision] Created AP/SSID Client Monitor (15 min) job for ${agent.name}`);
}

export { provisionDefaults as provision };
