/**
 * Default agent + persona provisioning.
 *
 * Called once at api-gateway startup (after loadSystemSecrets). Idempotent —
 * checks for existing records before creating. This ensures agents and personas
 * are always present after a DB reset, fresh install, or credential update via
 * the dashboard GUI.
 */
import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bex/credential-vault';

async function credentialExists(prisma: PrismaClient, name: string): Promise<boolean> {
  const cred = await prisma.credential.findFirst({ where: { name, scope: 'SYSTEM' }, select: { id: true } });
  return cred !== null;
}

async function agentExists(prisma: PrismaClient, ...names: string[]): Promise<boolean> {
  const agent = await prisma.agent.findFirst({ where: { name: { in: names } }, select: { id: true } });
  return agent !== null;
}

async function provisionXiqAgent(prisma: PrismaClient): Promise<boolean> {
  const xiqSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'extremecloudiq.' } },
    select: { id: true, domain: true },
  });
  if (xiqSkills.length === 0) {
    console.info('[provision] XIQ credentials present but no extremecloudiq.* skills installed — skipping agent creation');
    return false;
  }

  // seed-xciq-full.ts creates "ExtremeCloud IQ Monitor"; init.ts creates "ExtremeCloud IQ"
  if (await agentExists(prisma, 'ExtremeCloud IQ', 'ExtremeCloud IQ Monitor')) {
    console.info('[provision] ExtremeCloud IQ agent already exists — skipping');
    return true;
  }

  // Provision runs as system user
  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!systemUser) {
    console.warn('[provision] No system user found — run bex init first');
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
  return true;
}

async function provisionXcoAgent(prisma: PrismaClient): Promise<boolean> {
  const xcoSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'networking.extreme-xco.' } },
    select: { id: true, domain: true },
  });
  if (xcoSkills.length === 0) {
    console.info('[provision] XCO credentials present but no networking.extreme-xco.* skills installed — skipping agent creation');
    return false;
  }

  // setup-xco.js creates "XCO Monitor/Operator/Provisioner"; init.ts creates "ExtremeCloud Orchestrator"
  if (await agentExists(prisma, 'ExtremeCloud Orchestrator', 'XCO Monitor', 'XCO Operator', 'XCO Provisioner')) {
    console.info('[provision] ExtremeCloud Orchestrator agent already exists — skipping');
    return true;
  }

  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!systemUser) {
    console.warn('[provision] No system user found — run bex init first');
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
    console.info('[provision] Network Operations Manager persona already exists — skipping');
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
