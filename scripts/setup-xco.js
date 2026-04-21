#!/usr/bin/env node
/**
 * XCO Setup Script — builds real skills from XCO 4.0.0 API docs and configures
 * three specialised agents: Monitor, Operator, Provisioner.
 *
 * Run: node scripts/setup-xco.js
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const { SkillBuilderService } = require('@bclaw/skill-engine');

// LLM config — read from env so agents match the platform's configured provider
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_MODEL    = process.env.LLM_MODEL    || 'gpt-4o';

// Registry config for publishing skills
const REGISTRY_URL   = process.env.SKILL_REGISTRY_URL   || 'http://localhost:5050';
const REGISTRY_TOKEN = process.env.SKILL_REGISTRY_TOKEN || 'bex-registry-dev';

function log(msg) { console.log(`\n[XCO-SETUP] ${msg}`); }
function ok(msg)  { console.log(`  ✓ ${msg}`); }
function info(msg){ console.log(`  → ${msg}`); }

// ─── Skill sources ────────────────────────────────────────────────────────────

const XCO_AUTH_API = `# XCO Auth Service API (4.0.0)
Base URL: https://{xco-host}/rest/v1

## Authentication
POST /auth/token
  Body: { "username": "admin", "password": "password" }
  Response: { "access-token": "<jwt>", "token-type": "Bearer", "refresh-token": "<jwt>" }

POST /auth/token/refresh
  Body: { "grant-type": "refresh_token", "refresh-token": "<token>" }
  Response: { "access-token": "<jwt>", "refresh-token": "<jwt>" }

DELETE /auth/logout
  Removes the current access token (requires Bearer auth)

GET /auth/validate
  Validates the current Bearer token
  Response: 200 OK or 401 Unauthorized

GET /auth/token/expiry
  Query: type=ACCESS|REFRESH
  Response: { "type": "ACCESS", "hours": 0, "minutes": 15 }

PUT /auth/token/expiry
  Body: { "type": "ACCESS", "hours": 0, "minutes": 30 }

Notes:
- All endpoints except /auth/token require Bearer token in Authorization header
- Default token expiry is 15 minutes; use refresh token to get a new access token
- XCO uses JWT bearer tokens throughout
`;

const XCO_MONITOR_API = `# XCO Monitoring APIs (4.0.0)
Base URL: https://{xco-host}/rest/v1
All requests require: Authorization: Bearer {access-token}

## Fault Manager — Alarms
GET /faultmanager/alarm/summary
  Returns alarm counts by severity. Response:
  { "Alarms": [{ "Severity": "Critical", "Total": 8, "NotCleared": 2, "Cleared": 2, "NotClearedNotClosed": 1 }] }

GET /faultmanager/alarm/history
  Query params: severity=Critical|Major|Minor|Warning|Info, unacked=true, cleared=false, detail=true
  Pagination: page_size=20, sort_by=asc|desc
  Response: { "Alarms": [{ "AlarmID": 32000, "InstanceID": "2,3", "Name": "CertificateExpiration",
    "Resource": "/App/System/Security/Certificate", "AlarmType": "security", "IsCleared": false,
    "Severity": "Critical", "Message": "...", "TimeCreated": "2022-09-22T10:06:01", "LastRaised": "...",
    "IsAcked": false, "IsClosed": false }] }

GET /faultmanager/alarm
  Get alarm inventory — all possible alarm types XCO can raise
  Query: alarm_id=<int>, name=<string>, resource=<string>, alarm_type=<string>
  Response: { "Alarms": [{ "AlarmID": 32000, "Name": "CertificateExpiration", "Resource": "...", "AlarmType": "security" }] }

GET /faultmanager/alert/history
  Query: severity=Critical|Major|Minor|Warning|Info, limit=50
  Response: { "Alerts": [{ "AlertID": 31000, "Severity": "Warning", "Resource": "...", "Timestamp": "...", "Cause": "..." }] }

GET /faultmanager/health
  Returns fault manager service health
  Response: { "Service": "healthy", "MessageBus": "connected" }

## Fabric Service — Status & Topology
GET /fabric
  Get all fabrics. Query: detail=true for full info.
  Response: { "items": [{ "fabric-name": "BLR-FABRIC", "fabric-type": "clos", "fabric-status": "provisioned",
    "fabric-stage": 5, "number-of-provisioned-nodes": "9", "number-of-not-provisioned-nodes": "3",
    "number-of-provisioned-failed-nodes": "0", "number-of-config-gen-error-nodes": "0",
    "number-of-spine-nodes": "4", "fabric-id": 1 }] }

GET /fabric?name={fabric-name}&detail=true
  Get specific fabric with full detail.

GET /fabric/validate?fabric-name={name}
  Validate CLOS topology. Returns missing links, missing spines/leaves, configuration drifts.
  Response: { "fabric_name": "default", "missing_links": [], "missing_spines": false,
    "missing_leaves": false, "configuration_drifts": "{}", "redundant_links": [] }

GET /fabric/errors
  Get all fabric errors across all fabrics.
  Response: { "items": [{ "fabric_name": "default", "deviceErrorResponse": [
    { "error_reason": "No Spine Device", "role": "Spine", "error_type": "CLOS", "ip_address": "10.24.39.224" }] }] }

GET /fabric/errors?fabric-name={name}
  Get errors for a specific fabric.

## Monitor Service — System Health
GET /monitor/system
  Returns K8s pod/node/service health for the XCO platform itself.
  Response includes: deploymentConfig, nodes status, servicesStatus (with cpu/memory per service), pods

## Inventory Service — Device Inventory
GET /inventory/device
  List all registered switches/devices.
  Response: { "items": [{ "ip_address": "10.24.39.224", "role": "Spine", "name": "sw0",
    "model": "SLX-9140", "firmware": "20.3.2", "state": "Provisioned", "asn": 65000,
    "fabric": { "fabric_name": "default", "fabric_id": 1 }, "discovery_status": "Completed" }] }

GET /inventory/device?ip_address={ip}
  Get specific device details.
`;

const XCO_OPERATIONS_API = `# XCO Operations APIs (4.0.0) — Write/Modify Operations
Base URL: https://{xco-host}/rest/v1
All requests require: Authorization: Bearer {access-token}

## Alarm Operations (SUPERVISED — requires approval)
PUT /faultmanager/alarm/acknowledge
  Query: instance_id=2,3,5-10 (comma-separated or range), resource=<path>, comment=<string>
  Acknowledges active alarms. Returns updated alarm details.

PUT /faultmanager/alarm/close
  Query: instance_id=2,3,5-10, resource=<path>, comment=<string>
  Closes raised or cleared alarms.

DELETE /faultmanager/alarm/purge
  Purges ALL closed alarms. Irreversible operation — use with care.

## Fabric Operations (SUPERVISED — requires approval)
POST /fabric
  Create a new IP Fabric.
  Body: { "name": "BLR-FABRIC", "description": "Bengaluru DC", "stage": 5, "type": "clos" }
  fabric-type: "clos" or "non-clos"
  stage: 3 (3-stage CLOS), 5 (5-stage CLOS), 7 (7-stage CLOS)

DELETE /fabric?name={fabric-name}&force=false
  Delete an existing fabric. Set force=true to force-delete with devices.

POST /fabric/clone?source-fabric={src}&destination-fabric={dst}
  Clone a fabric topology from source to destination.

PUT /fabric/settings
  Update fabric settings (BGP, MTU, etc.)

## Device Operations (SUPERVISED — requires approval)
POST /inventory/device
  Register a new switch to XCO.
  Body: { "ip_address": "10.24.39.224", "username": "admin", "password": "secret", "fabric": "BLR-FABRIC" }

DELETE /inventory/device?ip_address={ip}
  Remove a device from XCO inventory.

PUT /inventory/device/setting
  Update switch settings (maintenance mode, etc.)
  Body: { "ip_address": "10.20.30.40", "keyval": [{ "key": "maintenance_mode_on_reboot", "value": "Yes" }] }

## SSH Access (via Forge ssh:exec permission)
SSH into switches at their management IP addresses using stored credentials.
Commands: show fabric, show bgp summary, show interface status, configure terminal, etc.
`;

// ─── Main setup ───────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();

  log('Connecting to database...');
  await prisma.$connect();
  ok('Database connected');

  // ── 1. Clean up old placeholder skills ──────────────────────────────────────
  log('Cleaning up placeholder XCO skills...');
  const oldSkills = await prisma.skill.findMany({
    where: { domain: { startsWith: 'networking.extreme-xco' } },
    select: { id: true, name: true, version: true },
  });
  for (const s of oldSkills) {
    // Detach from any agents first
    await prisma.agentSkill.deleteMany({ where: { skillId: s.id } });
    await prisma.skill.delete({ where: { id: s.id } });
    info(`Deleted old skill: ${s.name} v${s.version}`);
  }

  // ── 2. Build skills from real API docs ──────────────────────────────────────
  const builder = new SkillBuilderService(prisma, LLM_PROVIDER);

  log('Building networking.extreme-xco.monitor skill from real API docs...');
  info('Sources: Auth API + Fault Manager + Fabric Monitor + Inventory + System Monitor');
  const monitorResult = await builder.build({
    domain: 'networking.extreme-xco.monitor',
    intent: `Read-only monitoring skill for ExtremeCloud Orchestrator (XCO) 4.0.0.
Enables an agent to: authenticate to XCO, check fabric health and topology,
retrieve alarm summaries and histories (Critical/Major/Minor/Warning),
validate fabric CLOS topology, check device inventory and status,
monitor XCO platform service health (K8s pods/nodes), and detect configuration drifts.
Authentication uses POST /auth/token. All other calls use Bearer token.
This skill is READ-ONLY — no mutations.`,
    sources: [
      { type: 'raw_markdown', label: 'XCO-Auth-API-v4.0.0', content: XCO_AUTH_API },
      { type: 'raw_markdown', label: 'XCO-Monitor-API-v4.0.0', content: XCO_MONITOR_API },
    ],
  });
  ok(`Monitor skill created: ${monitorResult.skillId}`);
  info(`Name: ${monitorResult.skill.name}`);
  info(`Capabilities: ${monitorResult.skill.capabilities.join(', ')}`);
  info(`Tools: ${monitorResult.skill.tools.map(t => t.name).join(', ')}`);

  log('Building networking.extreme-xco.operations skill...');
  info('Sources: Auth API + Operations (alarm ack/close, fabric CRUD, device CRUD)');
  const opsResult = await builder.build({
    domain: 'networking.extreme-xco.operations',
    intent: `Write/operations skill for ExtremeCloud Orchestrator (XCO) 4.0.0.
Enables an agent to: acknowledge and close alarms, purge closed alarms,
create and delete IP fabrics (CLOS 3/5/7-stage, non-CLOS), clone fabrics,
update fabric settings, register and remove switches from XCO inventory,
update switch settings (e.g. maintenance mode).
ALL operations in this skill are write/modify operations requiring SUPERVISED approval.
Authentication uses POST /auth/token first.`,
    sources: [
      { type: 'raw_markdown', label: 'XCO-Auth-API-v4.0.0', content: XCO_AUTH_API },
      { type: 'raw_markdown', label: 'XCO-Operations-API-v4.0.0', content: XCO_OPERATIONS_API },
    ],
  });
  ok(`Operations skill created: ${opsResult.skillId}`);
  info(`Name: ${opsResult.skill.name}`);
  info(`Capabilities: ${opsResult.skill.capabilities.join(', ')}`);
  info(`Tools: ${opsResult.skill.tools.map(t => t.name).join(', ')}`);

  // ── 3. Publish skills locally and push to registry ──────────────────────────
  log('Publishing skills...');
  await prisma.skill.updateMany({
    where: { id: { in: [monitorResult.skillId, opsResult.skillId] } },
    data: { status: 'PUBLISHED' },
  });
  ok('Both skills published locally');

  // Push to skill registry so future installs can pull them
  for (const result of [monitorResult, opsResult]) {
    try {
      const res = await fetch(`${REGISTRY_URL}/registry/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${REGISTRY_TOKEN}`,
        },
        body: JSON.stringify({
          domain: result.skill.domain,
          name: result.skill.name,
          version: result.skill.version ?? '1.0.0',
          description: result.skill.description,
          capabilities: result.skill.capabilities,
          systemPrompt: result.skill.systemPrompt,
          tools: result.skill.tools,
        }),
      });
      if (res.ok) {
        ok(`Pushed to registry: ${result.skill.domain}`);
      } else {
        info(`Registry push skipped (${res.status}) for ${result.skill.domain} — install will work locally`);
      }
    } catch {
      info(`Registry unreachable — ${result.skill.domain} available locally`);
    }
  }

  // ── 4. Create agents ─────────────────────────────────────────────────────────
  log('Creating XCO Monitor Agent (AUTONOMOUS — read-only)...');
  const systemUser = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!systemUser) throw new Error('No system user found');

  const monitorAgent = await prisma.agent.create({
    data: {
      name: 'XCO Monitor',
      description: 'Autonomous read-only agent for monitoring XCO fabrics, alarms, devices, and service health.',
      llmProvider: LLM_PROVIDER,
      llmModel: LLM_MODEL,
      permissions: ['read:data', 'read:metrics'],
      status: 'ACTIVE',
      ownerId: systemUser.id,
      persona: {
        systemPromptOverride: `You are an XCO fabric monitoring specialist. When checking health:
1. Always authenticate first using xco_create_access_token.
2. Get the alarm summary to understand overall severity.
3. Get active (uncleared) Critical and Major alarms.
4. Get fabric list and validate topology for any drifts or errors.
5. Check device inventory for any devices not in Provisioned state.
6. Produce a structured health report: Overall Status, Active Alarms, Fabric State, Devices, Recommendations.
If you find Critical/Major uncleared alarms, explicitly flag them for escalation.`,
      },
      agentSkills: {
        create: [{ skillId: monitorResult.skillId }],
      },
    },
  });
  ok(`XCO Monitor created: ${monitorAgent.id}`);

  // Charter for Monitor agent — AUTONOMOUS for reads
  const monitorCharter = await prisma.agentCharter.create({
    data: {
      mandate: 'Continuously monitor ExtremeCloud Orchestrator fabric health. Collect and analyse alarm data, fabric topology, device inventory and platform service status. Flag Critical and Major issues immediately. Never perform write operations.',
      posture: 'AUTONOMOUS',
      bearing: 'ANALYTICAL',
      verbosity: 'STANDARD',
      conductBoundaries: ['write:*', 'delete:*', 'fabric.create', 'fabric.delete', 'alarm.purge'],
      escalationTriggers: ['Critical alarm', 'fabric provisioning failed', 'service unhealthy', 'configuration drift'],
    },
  });
  await prisma.agent.update({ where: { id: monitorAgent.id }, data: { charterId: monitorCharter.id } });
  ok('XCO Monitor charter set: AUTONOMOUS / ANALYTICAL');

  log('Creating XCO Operator Agent (SUPERVISED — read + alarm ops)...');
  const operatorAgent = await prisma.agent.create({
    data: {
      name: 'XCO Operator',
      description: 'Supervised operator agent for XCO. Can read all data and perform alarm management (acknowledge, close). All write operations require explicit approval.',
      llmProvider: LLM_PROVIDER,
      llmModel: LLM_MODEL,
      permissions: ['read:data', 'read:metrics', 'write:alarms'],
      status: 'ACTIVE',
      ownerId: systemUser.id,
      persona: {
        systemPromptOverride: `You are an XCO network operator. Before any write operation:
1. Confirm the exact scope (which alarms, which fabric, which devices).
2. Explain what you are about to do and why.
3. Wait for approval if your charter requires it.
For alarm acknowledgement: always include a meaningful comment explaining the action.
For alarm closure: only close alarms that are genuinely resolved.`,
      },
      agentSkills: {
        create: [
          { skillId: monitorResult.skillId },
          { skillId: opsResult.skillId },
        ],
      },
    },
  });
  ok(`XCO Operator created: ${operatorAgent.id}`);

  const operatorCharter = await prisma.agentCharter.create({
    data: {
      mandate: 'Operate ExtremeCloud Orchestrator at an operational level. Read all fabric and alarm data autonomously. For any write operation (alarm acknowledge/close, fabric settings), request explicit approval first. Never provision or delete fabrics without separate Provisioner agent involvement.',
      posture: 'SUPERVISED',
      bearing: 'FORMAL',
      verbosity: 'DETAILED',
      conductBoundaries: ['fabric.create', 'fabric.delete', 'device.register', 'device.remove', 'alarm.purge'],
      escalationTriggers: ['Critical alarm unacknowledged >30min', 'fabric provisioning failed', 'multiple devices offline'],
    },
  });
  await prisma.agent.update({ where: { id: operatorAgent.id }, data: { charterId: operatorCharter.id } });
  ok('XCO Operator charter set: SUPERVISED / FORMAL');

  log('Creating XCO Provisioner Agent (DELIBERATE — full fabric lifecycle)...');
  const provisionerAgent = await prisma.agent.create({
    data: {
      name: 'XCO Provisioner',
      description: 'Deliberate provisioner for XCO fabric lifecycle management. Creates/deletes fabrics, registers/removes devices. Every action requires explicit step-by-step approval.',
      llmProvider: LLM_PROVIDER,
      llmModel: LLM_MODEL,
      permissions: ['read:data', 'write:fabric', 'write:devices', 'ssh:exec'],
      status: 'ACTIVE',
      ownerId: systemUser.id,
      persona: {
        systemPromptOverride: `You are an XCO fabric provisioner. You handle fabric lifecycle:
- Creating new IP Fabrics (CLOS or non-CLOS, 3/5/7 stage)
- Registering switches to fabrics
- Cloning fabrics for staging environments
- Decommissioning devices and fabrics
Always present a detailed plan before executing ANY step. Use SSH to verify switch reachability before registration.
For fabric creation: validate all parameters, explain the topology, confirm device count matches the stage.`,
      },
      agentSkills: {
        create: [
          { skillId: monitorResult.skillId },
          { skillId: opsResult.skillId },
        ],
      },
    },
  });
  ok(`XCO Provisioner created: ${provisionerAgent.id}`);

  const provisionerCharter = await prisma.agentCharter.create({
    data: {
      mandate: 'Manage the full lifecycle of ExtremeCloud Orchestrator fabric infrastructure. Provision new fabrics and devices, clone topologies, decommission infrastructure. Operate with extreme caution — present a complete plan and get approval for EVERY step before execution.',
      posture: 'DELIBERATE',
      bearing: 'NARRATIVE',
      verbosity: 'DETAILED',
      conductBoundaries: ['alarm.purge', 'fabric.delete(force=true)'],
      escalationTriggers: ['provisioning rollback required', 'device registration failed repeatedly', 'fabric validation failed post-provisioning'],
    },
  });
  await prisma.agent.update({ where: { id: provisionerAgent.id }, data: { charterId: provisionerCharter.id } });
  ok('XCO Provisioner charter set: DELIBERATE / NARRATIVE');

  // ── 5. Set up scheduled monitoring ──────────────────────────────────────────
  log('Creating scheduled monitoring jobs...');

  const hourlyCheck = await prisma.scheduledJob.create({
    data: {
      name: 'XCO Hourly Health Check',
      description: 'Runs every hour: alarm summary, fabric status, device inventory, topology validation. Escalates Critical/Major issues.',
      agentId: monitorAgent.id,
      cronExpr: '0 * * * *',
      input: `Perform a full XCO health check:
1. Get alarm summary — count by severity
2. Get all uncleared Critical and Major alarms
3. Get fabric list with detail
4. Validate fabric topology for any CLOS drift
5. Check device inventory for devices not in Provisioned state
6. Check XCO platform service health

Produce a structured report with: Overall Health Status (HEALTHY/DEGRADED/CRITICAL), 
Active Critical Alarms, Active Major Alarms, Fabric Issues, Device Issues, Platform Issues.
If any Critical or Major uncleared alarms exist, flag the report as requiring operator attention.`,
      enabled: true,
    },
  });
  ok(`Hourly health check scheduled: ${hourlyCheck.id}`);

  const dailyDeepCheck = await prisma.scheduledJob.create({
    data: {
      name: 'XCO Daily Deep Audit',
      description: 'Daily deep audit: full alarm history review, configuration drift analysis, certificate expiry checks.',
      agentId: monitorAgent.id,
      cronExpr: '0 6 * * *',
      input: `Perform a comprehensive daily XCO audit:
1. Get full alarm history for the last 24 hours (all severities)
2. Get alert history — check for certificate expiry warnings
3. Validate ALL fabrics and identify any configuration drifts
4. Check all devices for firmware version consistency
5. Check token expiry configuration
6. Review fabric errors across all fabrics
7. Check XCO platform K8s pod and node health

Produce a detailed daily audit report with trend analysis (are alarm counts increasing?),
certificate expiry timeline, firmware inventory, and recommended maintenance actions.`,
      enabled: true,
    },
  });
  ok(`Daily deep audit scheduled: ${dailyDeepCheck.id}`);

  // ── 6. Final summary ─────────────────────────────────────────────────────────
  log('');
  log('═══════════════════════════════════════════════════════');
  log('  XCO SETUP COMPLETE');
  log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Skills (PUBLISHED):');
  console.log(`    networking.extreme-xco.monitor     ${monitorResult.skillId}`);
  console.log(`    networking.extreme-xco.operations  ${opsResult.skillId}`);
  console.log('');
  console.log('  Agents (ACTIVE):');
  console.log(`    XCO Monitor     ${monitorAgent.id}    (AUTONOMOUS)`);
  console.log(`    XCO Operator    ${operatorAgent.id}   (SUPERVISED)`);
  console.log(`    XCO Provisioner ${provisionerAgent.id} (DELIBERATE)`);
  console.log('');
  console.log('  Scheduled Jobs:');
  console.log(`    Hourly health check  ${hourlyCheck.id}  [0 * * * *]`);
  console.log(`    Daily deep audit     ${dailyDeepCheck.id}  [0 6 * * *]`);
  console.log('');
  console.log('  Next steps (when you have your XCO endpoint):');
  console.log('    1. Store credentials:');
  console.log('       POST /credentials  { name: "xco.primary", scope: "SYSTEM",');
  console.log('         value: { baseUrl: "https://<xco-host>/rest/v1", username: "admin", password: "..." },');
  console.log('         allowedAgentPermissions: ["read:data","read:metrics","write:alarms","write:fabric","write:devices"] }');
  console.log('');
  console.log('    2. Run an immediate health check:');
  console.log(`       POST /scheduled-jobs/${hourlyCheck.id}/run-now`);
  console.log('');
  console.log('    3. Ask the XCO Monitor directly:');
  console.log(`       POST /requests  { agentId: "${monitorAgent.id}",`);
  console.log('         input: "What is the current state of all XCO fabrics and alarms?" }');
  console.log('');
  console.log('    4. For new fabric provisioning, use the Provisioner:');
  console.log(`       POST /requests  { agentId: "${provisionerAgent.id}",`);
  console.log('         input: "Create a new 5-stage CLOS fabric named PROD-DC1 with spine/leaf details..." }');
  console.log('');
  console.log('  IDs saved to: ./xco-setup-output.json');

  const output = {
    skills: {
      monitor: { id: monitorResult.skillId, domain: 'networking.extreme-xco.monitor', capabilities: monitorResult.skill.capabilities },
      operations: { id: opsResult.skillId, domain: 'networking.extreme-xco.operations', capabilities: opsResult.skill.capabilities },
    },
    agents: {
      monitor: { id: monitorAgent.id, name: 'XCO Monitor', posture: 'AUTONOMOUS' },
      operator: { id: operatorAgent.id, name: 'XCO Operator', posture: 'SUPERVISED' },
      provisioner: { id: provisionerAgent.id, name: 'XCO Provisioner', posture: 'DELIBERATE' },
    },
    scheduledJobs: {
      hourlyHealthCheck: { id: hourlyCheck.id, cron: '0 * * * *' },
      dailyDeepAudit: { id: dailyDeepCheck.id, cron: '0 6 * * *' },
    },
  };

  require('fs').writeFileSync('./xco-setup-output.json', JSON.stringify(output, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error('\n[XCO-SETUP] FAILED:', e.message); console.error(e.stack); process.exit(1); });
