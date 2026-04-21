/**
 * Default agent + persona provisioning.
 *
 * Called once at api-gateway startup (after loadSystemSecrets). Idempotent —
 * checks for existing records before creating. This ensures agents and personas
 * are always present after a DB reset, fresh install, or credential update via
 * the dashboard GUI.
 */
import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bclaw/credential-vault';

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
    }

    if (xcoEnabled) {
      const ok = await provisionXcoAgent(prisma);
      if (ok) anyProvisioned = true;
    }

    if (anyProvisioned || (xiqEnabled || xcoEnabled)) {
      await provisionNetOpsPersona(prisma);
    }
  } catch (e) {
    // Provisioning failures must never block startup
    console.error('[provision] Error during default provisioning:', (e as Error).message);
  }
}
