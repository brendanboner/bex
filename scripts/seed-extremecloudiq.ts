/**
 * seed-extremecloudiq.ts
 * Creates the ExtremeCloud IQ skill, credential, and agent in the DB.
 * Run: npx tsx scripts/seed-extremecloudiq.ts
 */
import { PrismaClient } from '@prisma/client';
import { CredentialVaultService } from '../packages/credential-vault/src/service.js';

const prisma = new PrismaClient();
const vault = new CredentialVaultService(prisma);

const XCIQ_BASE = 'https://api.extremecloudiq.com';
const LOGIN_URL = `${XCIQ_BASE}/login`;

async function main() {
  // ── 1. Create/upsert the credential ──────────────────────────────────────
  let credentialId: string;
  const existingCred = await prisma.credential.findFirst({
    where: { name: 'ExtremeCloud IQ - bbonner' },
    select: { id: true },
  });

  if (existingCred) {
    credentialId = existingCred.id;
    console.log(`✔ Credential already exists: ${credentialId}`);
  } else {
    const cred = await vault.create({
      name: 'ExtremeCloud IQ - bbonner',
      description: 'ExtremeCloud IQ credentials for bbonner@extremenetworks.com',
      scope: 'SYSTEM',
      credentialType: 'USERNAME_PASSWORD',
      value: { username: 'bbonner@extremenetworks.com', password: 'caExtreme2023' },
      allowedAgentPermissions: ['xciq:read', 'xciq:write', '*'],
    });
    credentialId = cred.id;
    console.log(`✔ Created credential: ${credentialId}`);
  }

  // ── 2. Create/update the skill ────────────────────────────────────────────
  const skillData = {
    name: 'ExtremeCloud IQ',
    domain: 'extremecloudiq.networking',
    description: 'Manage and monitor your ExtremeCloud IQ wireless network — list devices, check client connections, view alerts, and manage APs.',
    version: '1.0.0',
    capabilities: [
      'list wireless access points and devices',
      'list clients connected to an AP or SSID',
      'find device by name or hostname',
      'check device connectivity status',
      'view network alerts and events',
      'list active wireless clients',
      'get client details by MAC address',
      'list SSIDs and network policies',
    ],
    systemPrompt: `You are an ExtremeCloud IQ network assistant. You have access to a live ExtremeCloud IQ account via API.

When asked about devices, clients, or network status:
1. Use list_devices to find APs by name. Each device has an id, hostname, ip_address, connected status.
2. Use list_active_clients with a deviceIds parameter (device numeric ID) to list connected clients.
3. Present client lists clearly: hostname, MAC address, IP, SSID, OS type.
4. If a device name is given (e.g. "FrontAP3000"), first find its numeric ID via list_devices, then fetch clients.

Always be concise and format output in a readable way for Telegram messages.`,
    tools: [
      {
        name: 'list_devices',
        description: 'List all wireless access points and devices in ExtremeCloud IQ. Returns device IDs, hostnames, IP addresses, and connection status.',
        handlerType: 'xciq_http_call',
        config: {
          loginUrl: LOGIN_URL,
          method: 'GET',
          urlTemplate: `${XCIQ_BASE}/devices?page=1&limit=100`,
        },
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'list_active_clients',
        description: 'List currently active/connected wireless clients. Optionally filter by device ID (use the numeric device id from list_devices). Returns hostname, MAC, IP, SSID, and OS type for each client.',
        handlerType: 'xciq_http_call',
        config: {
          loginUrl: LOGIN_URL,
          method: 'GET',
          urlTemplate: `${XCIQ_BASE}/clients/active?page=1&limit=100&deviceIds={deviceIds}`,
        },
        parameters: {
          type: 'object',
          properties: {
            deviceIds: {
              type: 'string',
              description: 'Numeric device ID to filter clients (from list_devices). Leave empty for all clients.',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_client_details',
        description: 'Get detailed information about a specific client by MAC address.',
        handlerType: 'xciq_http_call',
        config: {
          loginUrl: LOGIN_URL,
          method: 'GET',
          urlTemplate: `${XCIQ_BASE}/client-details/overview/info/{clientId}`,
        },
        parameters: {
          type: 'object',
          properties: {
            clientId: {
              type: 'string',
              description: 'The client ID (numeric, from list_active_clients)',
            },
          },
          required: ['clientId'],
        },
      },
      {
        name: 'list_alerts',
        description: 'List recent network alerts and events from ExtremeCloud IQ.',
        handlerType: 'xciq_http_call',
        config: {
          loginUrl: LOGIN_URL,
          method: 'GET',
          urlTemplate: `${XCIQ_BASE}/alerts?page=1&limit=50`,
        },
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };

  let skillId: string;
  const existingSkill = await prisma.skill.findFirst({
    where: { domain: 'extremecloudiq.networking' },
    select: { id: true },
  });

  if (existingSkill) {
    const updated = await prisma.skill.update({
      where: { id: existingSkill.id },
      data: {
        name: skillData.name,
        description: skillData.description,
        version: skillData.version,
        capabilities: skillData.capabilities,
        systemPrompt: skillData.systemPrompt,
        tools: skillData.tools as any,
      },
    });
    skillId = updated.id;
    console.log(`✔ Updated skill: ${skillId}`);
  } else {
    const created = await prisma.skill.create({
      data: {
        name: skillData.name,
        domain: skillData.domain,
        description: skillData.description,
        version: skillData.version,
        capabilities: skillData.capabilities,
        systemPrompt: skillData.systemPrompt,
        tools: skillData.tools as any,
      },
    });
    skillId = created.id;
    console.log(`✔ Created skill: ${skillId}`);
  }

  // ── 3. Get system owner ────────────────────────────────────────────────────
  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) throw new Error('No users found — run bex init first');

  // ── 4. Create/update agent ────────────────────────────────────────────────
  let agentId: string;
  const existingAgent = await prisma.agent.findFirst({
    where: { name: 'ExtremeCloud IQ Monitor' },
    select: { id: true },
  });

  const agentData = {
    name: 'ExtremeCloud IQ Monitor',
    description: 'Monitors your ExtremeCloud IQ wireless network — lists APs, connected clients, and alerts.',
    llmProvider: 'anthropic',
    llmModel: 'claude-3-5-sonnet-20241022',
    permissions: ['xciq:read', 'xciq:write'],
    persona: {
      systemPrompt: 'You are a helpful ExtremeCloud IQ network assistant. Format responses concisely for Telegram.',
    },
    ownerId: owner.id,
  };

  if (existingAgent) {
    await prisma.agent.update({ where: { id: existingAgent.id }, data: agentData });
    agentId = existingAgent.id;
    console.log(`✔ Updated agent: ${agentId}`);
  } else {
    const agent = await prisma.agent.create({ data: agentData });
    agentId = agent.id;
    console.log(`✔ Created agent: ${agentId}`);
  }

  // ── 5. Link skill to agent ────────────────────────────────────────────────
  const existingLink = await prisma.agentSkill.findFirst({
    where: { agentId, skillId },
  });
  if (!existingLink) {
    await prisma.agentSkill.create({ data: { agentId, skillId } });
    console.log(`✔ Linked skill to agent`);
  } else {
    console.log(`✔ Skill already linked`);
  }

  // ── 6. Give agent AUTONOMOUS charter ─────────────────────────────────────
  const existingCharter = await prisma.agentCharter.findFirst({
    where: { agent: { id: agentId } },
  });
  let charterId: string;
  if (existingCharter) {
    await prisma.agentCharter.update({
      where: { id: existingCharter.id },
      data: { posture: 'AUTONOMOUS' },
    });
    charterId = existingCharter.id;
  } else {
    const charter = await prisma.agentCharter.create({
      data: {
        mandate: 'Monitor and report on the ExtremeCloud IQ wireless network. List devices, clients, and alerts on request.',
        posture: 'AUTONOMOUS',
        conductBoundaries: [],
        escalationTriggers: [],
      },
    });
    charterId = charter.id;
  }
  await prisma.agent.update({ where: { id: agentId }, data: { charterId } });
  console.log(`✔ Charter set: ${charterId}`);

  // ── 7. Link credential to agent (via allowedAgentPermissions) ─────────────
  await prisma.credential.update({
    where: { id: credentialId },
    data: { allowedAgentPermissions: ['xciq:read', 'xciq:write', '*'] },
  });
  console.log(`✔ Credential permissions updated`);

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log(`  Skill ID:      ${skillId}`);
  console.log(`  Agent ID:      ${agentId}`);
  console.log(`  Credential ID: ${credentialId}`);
  console.log('══════════════════════════════════════════');
  console.log('');
  console.log('Set XCIQ_AGENT_ID in .env or use agent ID above.');
  console.log('Update TELEGRAM_DEFAULT_AGENT_ID to route Telegram to this agent.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
