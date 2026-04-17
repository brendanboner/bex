# Forge — End-to-End Flow Guide

This document walks through every way to interact with the Forge Enterprise Agentic Platform: CLI, Web Dashboard, REST API, and messaging channels (Telegram/Teams/WhatsApp). Use it as a complete reference from first boot to production operations.

---

## Table of Contents

1. [First Run — CLI (`bforge init`)](#1-first-run--cli-bforge-init)
2. [Dashboard GUI Walkthrough](#2-dashboard-gui-walkthrough)
3. [Authentication & Token Management](#3-authentication--token-management)
4. [Building and Publishing a Skill](#4-building-and-publishing-a-skill)
5. [XCO Monitoring — Complete Use Case](#5-xco-monitoring--complete-use-case)
6. [Coordinator Chat — Natural Language Interface](#6-coordinator-chat--natural-language-interface)
7. [Agent Charter & Persona Configuration](#7-agent-charter--persona-configuration)
8. [Multi-Domain Scenario (XIQ + XCO + Kubernetes)](#8-multi-domain-scenario-xiq--xco--kubernetes)
9. [Federated Skill Sharing](#9-federated-skill-sharing)
10. [Approval Workflow](#10-approval-workflow)
11. [Telegram Channel Integration](#11-telegram-channel-integration)
12. [Scheduled Monitoring & Escalation](#12-scheduled-monitoring--escalation)
13. [Full API Reference](#13-full-api-reference)

---

## 1. First Run — CLI (`bforge init`)

### Prerequisites

- Node.js 20+, npm 10+
- Docker (running)
- An LLM API key: [OpenAI](https://platform.openai.com/api-keys), [Anthropic](https://console.anthropic.com/), or Azure OpenAI

### Installation

```bash
git clone https://github.com/your-org/forge
cd forge
npm install
```

### Running `bforge init`

```bash
node packages/cli/dist/bin/bforge.js init

# Or after global install:
npm install -g ./packages/cli
bforge init
```

**Full annotated wizard output:**

```
╔══════════════════════════════════════════════════════╗
║   Forge — Enterprise Agentic Platform                ║
║   Autonomous agents. Domain skills. Secure by design.║
╚══════════════════════════════════════════════════════╝

Step 1 of 4: LLM Provider

? LLM provider:
  ❯ OpenAI (GPT-4o)
    Anthropic (Claude)
    Azure OpenAI

? OpenAI API key: sk-proj-••••••••••••••••
  ✓ API key validated (GPT-4o available)

? Default model:
  ❯ gpt-4o
    gpt-4o-mini
    gpt-4-turbo
    gpt-3.5-turbo

Step 2 of 4: Interface Channel

? Primary interface channel:
  ❯ Web Dashboard only  (add channels later)
    Telegram Bot
    Microsoft Teams
    WhatsApp (via Twilio)

Step 3 of 4: Admin Account

? Admin email: admin@acme.com
? Admin password (min 8 chars): ••••••••••
? Confirm password: ••••••••••

Step 4 of 4: Generating configuration

  ✓ JWT secret generated
  ✓ Vault encryption key generated
  ✓ Postgres password generated
  ✓ .env written

? Start the platform now? Yes

  ✓ Services started
  ✓ API Gateway ready    http://localhost:4000
  ✓ Migrations applied
  ✓ Admin account created
  ✓ Dashboard ready      http://localhost:3000

╔══════════════════════════════════════════════════════╗
║  ✓ Forge is running!                                ║
║  Dashboard:  http://localhost:3000                  ║
║  API:        http://localhost:4000                  ║
║  Login:      admin@acme.com                         ║
╚══════════════════════════════════════════════════════╝
```

### Other CLI Commands

```bash
# Check service health
bforge status

# Output:
# Forge Service Status
# ──────────────────────────────────────────────────
#   ● API Gateway          healthy  (42ms)  http://localhost:4000/health
#   ● Dashboard            healthy  (18ms)  http://localhost:3000
#
# Docker Containers
# ──────────────────────────────────────────────────
# NAME                     STATUS          PORTS
# forge-api-gateway-1      Up 3 hours      0.0.0.0:4000->4000/tcp
# forge-dashboard-1        Up 3 hours      0.0.0.0:3000->3000/tcp
# forge-postgres-1         Up 3 hours (healthy)
# forge-redis-1            Up 3 hours (healthy)

# Tail all logs
bforge logs

# Tail API gateway only
bforge logs api

# Stop everything
bforge stop

# Restart
bforge start
```

---

## 2. Dashboard GUI Walkthrough

Open `http://localhost:3000` and log in with your admin credentials.

### Screen: Dashboard Overview

The main dashboard shows:
- **Active Agents** — count and last active time
- **Pending Approvals** — requests waiting for your action
- **Recent Activity** — last 20 agent requests with status
- **Skill Registry** — published skills available to agents

### Screen: Agents → Create Agent

1. Click **Agents** in the sidebar
2. Click **+ New Agent**
3. Fill in:
   - **Name**: `XCO London Monitor`
   - **Description**: `Hourly health monitoring for the XCO London site`
   - **LLM Provider**: `OpenAI`
   - **Model**: `gpt-4o`
   - **Status**: `Active`
4. Under **Permissions**, add: `read:network`, `ssh:exec`
5. Click **Create Agent**

### Screen: Agents → Charter Editor

Once an agent is created, click **Charter** to configure its operational behaviour:

- **Posture**: `SUPERVISED` — the agent acts but notifies you on each major step
- **Bearing**: `ANALYTICAL` — responses include reasoning and evidence
- **Verbosity**: `STANDARD`
- **Mandate**: `Monitor XCO network health. Detect alarms, drift, and anomalies. Do not modify configuration without explicit approval.`
- **Conduct Boundaries**: Add `write:network` → requires approval before any config changes
- **Escalation Triggers**: Add `CRITICAL alarm detected`, `Fabric member offline`

Click **Save Charter**.

### Screen: Skills → Build Skill

1. Click **Skills → Build Skill**
2. Fill in:
   - **Domain**: `networking.extreme-xco`
   - **Intent**: `Monitor Extreme Networks XCO — detect alarms, drift, topology changes; execute SSH commands`
3. Under **Knowledge Sources**, click **+ Add Source**:
   - Type: `OpenAPI URL`, URL: `https://your-xco-host/api/openapi.json`, Label: `XCO REST API`
   - Type: `PDF URL`, URL: `https://extremenetworks.com/docs/xco-api-guide.pdf`, Label: `XCO API Guide`
4. Click **Build Skill** — generation takes 15–45 seconds
5. Review generated tools (e.g. `get_devices`, `get_alarms`, `get_fabric`, `ssh_exec`)
6. Click **Run Tests** — automated test suite validates all tools
7. Click **Publish**

### Screen: Targets → Add Target

1. Click **Targets → + Add Target**
2. Fill in:
   - **Name**: `xco-london`
   - **Hostname**: `10.0.0.1`
   - **API Base URL**: `https://10.0.0.1:8443`
   - **Tags**: `xco`, `london`, `core`
   - **Credential**: Select or create `xco-london-creds`
3. Click **Verify SSH** — green tick means connectivity confirmed
4. Click **Save Target**

### Screen: Coordinator Chat

Click **Coordinator** in the sidebar. This is the natural-language interface to the entire platform.

Example conversation — building an agent from scratch by describing the goal:

```
You: I want to monitor the drift on my XCO network site at 10.0.0.1

Coordinator: I can help set that up. I don't see an XCO skill in the registry yet.
  To build one, I'll need the XCO API documentation. Do you have:
  (a) An OpenAPI/Swagger URL from your XCO controller
  (b) PDF documentation you can link to
  (c) Both

You: I have both — API is at https://10.0.0.1/api/openapi.json and here's the PDF:
  https://extremenetworks.com/docs/xco-guide.pdf

Coordinator: Building the extreme_networks_xco skill now...
  ✓ OpenAPI parsed — 47 endpoints discovered
  ✓ PDF processed — authentication and error patterns extracted
  ✓ Skill generated — 12 tools: get_devices, get_alarms, get_fabric_topology,
    get_vlan_config, get_port_stats, create_vlan, delete_vlan,
    acknowledge_alarm, get_port_neighbors, ssh_exec, get_system_health,
    get_bgp_peers
  ✓ Tests passed — 12/12
  ✓ Skill published as networking.extreme-xco v1.0.0

  Next: I'll create a monitoring agent and set up hourly checks. What's the
  hostname and credentials for your XCO controller?
```

### Screen: Personas → Generate Persona

Personas let you auto-generate a complete agent personality and skill set from a high-level goal.

1. Click **Personas → Generate Persona**
2. Enter goal: `I need a network operations agent that monitors Extreme Networks infrastructure, detects anomalies, and escalates critical issues for human approval`
3. Click **Generate** — the LLM creates a full persona spec:
   - Name: `NetOps Sentinel`
   - Domain: `networking.extreme-networks`
   - Capabilities: `['monitor_network', 'detect_anomalies', 'read_alarms', 'ssh_exec', 'escalate']`
   - Posture: `SUPERVISED`
4. Click **Spawn Agent** — creates the agent, assigns relevant skills, schedules monitoring

---

## 3. Authentication & Token Management

### Get a token via login

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "your-password"}' \
  | jq -r '.data.token')

echo $TOKEN
# eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Use the token

```bash
# All subsequent requests use: -H "Authorization: Bearer $TOKEN"
curl http://localhost:4000/agents \
  -H "Authorization: Bearer $TOKEN"
```

### Check setup status (no auth required)

```bash
curl http://localhost:4000/admin/setup/status
# {"ok":true,"data":{"configured":true}}
```

---

## 4. Building and Publishing a Skill

### Build via API

```bash
SKILL=$(curl -s -X POST http://localhost:4000/skills/build \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "networking.extreme-xco",
    "intent": "Monitor Extreme Networks XCO fabric — detect alarms, drift, topology changes",
    "sources": [
      {
        "type": "OPENAPI_JSON",
        "url": "https://10.0.0.1/api/openapi.json",
        "label": "XCO REST API"
      },
      {
        "type": "PDF",
        "url": "https://extremenetworks.com/docs/xco-api-guide.pdf",
        "label": "XCO API Guide"
      }
    ]
  }')

SKILL_ID=$(echo $SKILL | jq -r '.data.id')
echo "Skill ID: $SKILL_ID"
```

### Test the skill

```bash
TEST_RESULT=$(curl -s -X POST http://localhost:4000/skills/$SKILL_ID/test \
  -H "Authorization: Bearer $TOKEN")

echo $TEST_RESULT | jq '{passed: .data.passed, failed: .data.failed}'
# {"passed": 12, "failed": 0}
```

### Publish the skill

```bash
curl -X POST http://localhost:4000/skills/$SKILL_ID/publish \
  -H "Authorization: Bearer $TOKEN"
# {"ok":true,"data":{"status":"PUBLISHED"}}
```

### Discover skills by intent

```bash
curl "http://localhost:4000/skills/discover" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intent": "monitor network alarms", "domain": "networking"}'
# Returns ranked list of matching skills
```

---

## 5. XCO Monitoring — Complete Use Case

This section shows the full journey from zero to a running hourly monitor with escalation.

### Step 1: Store credentials in the vault

```bash
CRED=$(curl -s -X POST http://localhost:4000/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "xco-london-creds",
    "description": "XCO London controller credentials",
    "scope": "SYSTEM",
    "value": {
      "username": "admin",
      "password": "xco-secret-password"
    },
    "allowedAgentPermissions": ["read:network", "write:network", "ssh:exec"]
  }')

CRED_ID=$(echo $CRED | jq -r '.data.id')
echo "Credential ID: $CRED_ID"
```

### Step 2: Add the XCO target

```bash
TARGET=$(curl -s -X POST http://localhost:4000/targets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "xco-london",
    "description": "XCO London site controller",
    "hostname": "10.0.0.1",
    "sshPort": 22,
    "apiBaseUrl": "https://10.0.0.1:8443",
    "tags": ["xco", "london", "core"],
    "credentialId": "'$CRED_ID'"
  }')

TARGET_ID=$(echo $TARGET | jq -r '.data.id')
```

### Step 3: Verify SSH connectivity

```bash
curl -X POST http://localhost:4000/targets/$TARGET_ID/verify-ssh \
  -H "Authorization: Bearer $TOKEN"
# {"ok":true,"data":{"connected":true,"fingerprint":"SHA256:abc123..."}}
```

### Step 4: Build the XCO skill (if not already done)

```bash
# (See Section 4 above)
SKILL_ID="skill_xxxxxxxxxxxxxxx"
```

### Step 5: Create the monitoring agent

```bash
AGENT=$(curl -s -X POST http://localhost:4000/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London Monitor",
    "description": "Hourly health monitoring agent for XCO London site",
    "llmProvider": "openai",
    "llmModel": "gpt-4o",
    "permissions": ["read:network", "ssh:exec"],
    "skillIds": ["'$SKILL_ID'"],
    "status": "ACTIVE"
  }')

AGENT_ID=$(echo $AGENT | jq -r '.data.id')
```

### Step 6: Configure the agent charter

```bash
curl -X PUT http://localhost:4000/agents/$AGENT_ID/charter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "posture": "SUPERVISED",
    "bearing": "ANALYTICAL",
    "verbosity": "STANDARD",
    "mandate": "Monitor XCO London network health. Detect alarms, fabric drift, and topology anomalies. Never modify configuration without explicit human approval.",
    "conductBoundaries": ["write:network", "ssh:exec:write"],
    "escalationTriggers": ["CRITICAL alarm", "fabric member offline", "BGP session down"]
  }'
```

### Step 7: Create the remediation agent (with write permissions)

```bash
REMEDIATION_AGENT=$(curl -s -X POST http://localhost:4000/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London Remediation",
    "description": "Fixes issues detected by the monitoring agent",
    "llmProvider": "openai",
    "llmModel": "gpt-4o",
    "permissions": ["read:network", "write:network", "ssh:exec"],
    "skillIds": ["'$SKILL_ID'"],
    "status": "ACTIVE"
  }')

REMEDIATION_ID=$(echo $REMEDIATION_AGENT | jq -r '.data.id')
```

### Step 8: Schedule hourly monitoring

```bash
curl -X POST http://localhost:4000/requests \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "'$AGENT_ID'",
    "input": "Run hourly health check on XCO London. Check for: (1) active alarms, (2) fabric member status, (3) port error rates >1%, (4) BGP session state. Return a structured MonitoringResult.",
    "channel": "scheduler"
  }'

# Then schedule it (via dashboard-api):
curl -X POST http://localhost:4001/admin/scheduled-jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London — Hourly Health Check",
    "description": "Automated hourly monitoring with escalation",
    "agentId": "'$AGENT_ID'",
    "cronExpr": "0 * * * *",
    "input": "Run hourly health check on XCO London. Check for active alarms, fabric member status, port error rates >1%, BGP session state. Escalate if CRITICAL alarms found.",
    "enabled": true
  }'
```

### Step 9: Run a one-off check

```bash
REQUEST=$(curl -s -X POST http://localhost:4000/requests \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "'$AGENT_ID'",
    "input": "What is the current state of the XCO London fabric? Any active alarms?",
    "channel": "api"
  }')

REQUEST_ID=$(echo $REQUEST | jq -r '.data.id')

# Poll until complete
watch -n 2 "curl -s http://localhost:4000/requests/$REQUEST_ID \
  -H 'Authorization: Bearer $TOKEN' | jq '.data.status'"

# Get the result
curl -s http://localhost:4000/requests/$REQUEST_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.data.result'
```

**Example result:**

```json
{
  "status": "healthy",
  "alarms": [],
  "fabricMembers": [
    {"name": "spine-1", "status": "online"},
    {"name": "spine-2", "status": "online"},
    {"name": "leaf-1", "status": "online"}
  ],
  "portErrors": 0,
  "bgpSessions": [
    {"peer": "10.0.0.254", "state": "Established"}
  ],
  "summary": "XCO London is healthy. No active alarms. All 3 fabric members online."
}
```

### Step 10: SSH command execution

```bash
# Execute a read-only SSH command directly against a target
curl -X POST http://localhost:4000/targets/$TARGET_ID/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "show fabric-attachment",
    "timeout": 30
  }'

# Response:
# {"ok":true,"data":{"stdout":"Fabric: prod-fabric-1\n  Members: 3/3 online\n...","exitCode":0}}
```

---

## 6. Coordinator Chat — Natural Language Interface

The Coordinator is the LLM-driven orchestration layer. It interprets natural language, plans multi-step workflows, and delegates to agents.

### Start a conversation

```bash
SESSION=$(curl -s -X POST http://localhost:4000/coordinator/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I want to set up monitoring for my XCO network",
    "channel": "api"
  }')

SESSION_ID=$(echo $SESSION | jq -r '.data.sessionId')
echo "$SESSION" | jq -r '.data.response'

# Coordinator: "I can help you set up XCO monitoring. First, let me check what
# skills are available... I see there's no XCO skill yet. To build one, I'll
# need the API documentation. Do you have an OpenAPI URL or PDF for your XCO
# controller?"
```

### Continue the conversation

```bash
curl -X POST http://localhost:4000/coordinator/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Yes, the OpenAPI is at https://10.0.0.1/openapi.json",
    "sessionId": "'$SESSION_ID'",
    "channel": "api"
  }' | jq -r '.data.response'

# Coordinator: "Building the XCO skill now... [uses skill builder meta-tool]
# ✓ Skill generated with 12 tools. Tests passed 12/12.
# ✓ Skill published as networking.extreme-xco v1.0.0
#
# Now I'll create a monitoring agent. What's the IP address and credentials
# for your XCO controller?"
```

### Ask the coordinator to plan a complex workflow

```bash
curl -X POST http://localhost:4000/coordinator/plan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Set up 24/7 monitoring for 5 XCO sites with automatic remediation of common faults and weekly summary reports"
  }' | jq '.data'

# Returns a structured WorkflowPlan:
# {
#   "steps": [
#     {"id": 1, "action": "build_skill", "domain": "networking.extreme-xco"},
#     {"id": 2, "action": "create_agents", "count": 5, "type": "monitoring"},
#     {"id": 3, "action": "create_agents", "count": 1, "type": "remediation"},
#     {"id": 4, "action": "schedule_jobs", "cron": "0 * * * *"},
#     {"id": 5, "action": "schedule_jobs", "cron": "0 8 * * 1", "type": "report"}
#   ],
#   "estimatedTime": "10 minutes",
#   "requiresApproval": ["remediation agent write permissions"]
# }
```

### Ask about current state

```bash
curl -X POST http://localhost:4000/coordinator/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How are all my agents doing? Any issues?",
    "sessionId": "'$SESSION_ID'"
  }' | jq -r '.data.response'

# Coordinator: "Here's a summary of your 3 active agents:
#
# ✓ XCO London Monitor — Last ran 23 min ago. Status: healthy.
# ✓ XCO Paris Monitor — Last ran 58 min ago. Status: 1 WARNING alarm.
# ⚠ XCO Berlin Monitor — Last ran 2 hrs ago (overdue). Check scheduler.
#
# The Paris site has a WARNING on port xe-0/0/1. Do you want me to
# ask the remediation agent to investigate?"
```

### List sessions

```bash
curl http://localhost:4000/coordinator/sessions \
  -H "Authorization: Bearer $TOKEN" | jq '.data'
```

---

## 7. Agent Charter & Persona Configuration

### Available posture options

| Posture | Behaviour |
|---------|-----------|
| `AUTONOMOUS` | Acts independently, notifies on completion only |
| `SUPERVISED` | Acts but notifies at each significant step |
| `INTERACTIVE` | Asks for confirmation at decision points |
| `DELIBERATE` | Proposes all actions, waits for explicit approval |

### Set posture via API

```bash
# Make an agent fully autonomous
curl -X PATCH http://localhost:4000/agents/$AGENT_ID/charter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"posture": "AUTONOMOUS"}'

# Make it require approval for everything
curl -X PATCH http://localhost:4000/agents/$AGENT_ID/charter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"posture": "DELIBERATE"}'
```

### Full charter configuration

```bash
curl -X PUT http://localhost:4000/agents/$AGENT_ID/charter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "posture": "SUPERVISED",
    "bearing": "ANALYTICAL",
    "verbosity": "DETAILED",
    "mandate": "You are the primary monitoring agent for Extreme Networks infrastructure. Your mission is to detect and report anomalies. You may read any system state. You must never modify configuration without explicit human approval.",
    "scopeLimits": ["networking.extreme-xco", "networking.extreme-xiq"],
    "conductBoundaries": [
      "write:network",
      "delete:vlan",
      "ssh:exec:write"
    ],
    "escalationTriggers": [
      "CRITICAL alarm detected",
      "Fabric member offline for >5 minutes",
      "BGP session flapping",
      "Port error rate >5%"
    ]
  }'
```

### Generate a persona automatically

```bash
curl -X POST http://localhost:4000/personas/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "An agent that monitors Kubernetes cluster health, detects pod crashes and resource exhaustion, and coordinates with network agents to correlate infrastructure issues"
  }' | jq '.data'

# Returns:
# {
#   "name": "K8s Sentinel",
#   "domain": "infrastructure.kubernetes",
#   "capabilities": ["monitor_pods", "check_resources", "detect_crashes", "correlate_network"],
#   "posture": "SUPERVISED",
#   "bearing": "ANALYTICAL",
#   "suggestedSkills": ["infrastructure.kubernetes", "networking.cni"]
# }
```

### Spawn the persona as a live agent

```bash
PERSONA_ID="persona_xxxxxxx"

curl -X POST http://localhost:4000/personas/$PERSONA_ID/spawn \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "K8s Sentinel — Production",
    "scheduleMonitoring": true,
    "cronExpr": "*/15 * * * *"
  }'
```

---

## 8. Multi-Domain Scenario (XIQ + XCO + Kubernetes)

This example shows the coordinator correlating data across three independent systems.

### The request (via Coordinator Chat)

```
You: Compare the utilisation on the switches managed by Extreme XIQ with 
     the fabric configurations in XCO London, then cross-reference against 
     the Kubernetes cluster load to see if there's a bottleneck.

Coordinator: This spans three domains: XIQ (switch utilisation), XCO 
     (fabric topology), and Kubernetes (pod scheduling + resource use).
     
     Let me check what skills I have...
     ✓ networking.extreme-xiq — available
     ✓ networking.extreme-xco — available
     ✗ infrastructure.kubernetes — not found
     
     I'll need to build the Kubernetes skill before I can continue.
     Do you have the Kubernetes API endpoint and auth config?

You: Yes, the API is at https://k8s.acme.com:6443. Here's a service
     account token: eyJhbGciOiJSUzI1NiIsInR5...

Coordinator: Building the Kubernetes skill now...
     ✓ Skill generated — 9 tools: get_pods, get_nodes, get_deployments,
       get_resource_usage, get_events, get_services, exec_pod, get_logs,
       get_metrics
     ✓ Tests passed 9/9
     ✓ Skill published as infrastructure.kubernetes v1.0.0

     Now running the correlated analysis...
     [spawning XIQ agent → querying switch utilisation]
     [spawning XCO agent → querying fabric topology]
     [spawning K8s agent → querying cluster load]
     [aggregating results...]

     Analysis complete:

     FINDING: Bottleneck detected on leaf-3 in XCO London fabric.
     
     - XIQ reports xe-0/0/24 on leaf-3 at 94% utilisation (peak: 99%)
     - XCO shows leaf-3 carries traffic for VLANs 100, 200, 300 (prod workloads)
     - K8s shows the production namespace has 3 Deployment pods scheduled 
       exclusively on worker nodes behind leaf-3 (workers 4, 5, 6)
     
     Root cause: Pod anti-affinity rules are not distributing load across 
     fabric leaf nodes. All prod pods are concentrated behind leaf-3.
     
     Recommended actions:
     1. Add topology spread constraints to the 3 affected Deployments
     2. Or provision additional uplinks on leaf-3 (VLAN trunking via XCO)
     
     Shall I proceed with option 1 (requires K8s write permission)?
```

### Register cross-domain constraints

When XIQ and XCO have limited compatibility (XIQ doesn't manage all XCO systems):

```bash
curl -X POST http://localhost:4000/constraints \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain1": "networking.extreme-xiq",
    "domain2": "networking.extreme-xco",
    "compatibility": "PARTIAL",
    "notes": "XIQ manages fabric overview but cannot modify XCO-native fabrics. Use XCO API for all write operations on XCO-managed sites."
  }'
```

The coordinator automatically checks these constraints before delegating cross-domain tasks.

---

## 9. Federated Skill Sharing

Skills can be published to a central registry and pulled by other Forge instances.

### Set the registry URL (in .env)

```bash
SKILL_REGISTRY_URL=https://skills.your-org.com
```

### Publish a skill to the central registry

```bash
curl -X POST http://localhost:4000/registry/publish \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "'$SKILL_ID'",
    "registryUrl": "https://skills.your-org.com"
  }'

# Response:
# {
#   "ok": true,
#   "data": {
#     "domain": "networking.extreme-xco",
#     "version": "1.0.0",
#     "checksum": "sha256:a1b2c3d4...",
#     "registryUrl": "https://skills.your-org.com/skills/networking.extreme-xco/1.0.0"
#   }
# }
```

### Browse the registry from another instance

```bash
# List available skills
curl http://other-forge-instance:4000/registry/skills \
  -H "Authorization: Bearer $OTHER_TOKEN" | jq '.data'

# Search for a specific skill
curl "http://other-forge-instance:4000/registry/skills?q=extreme-xco" \
  -H "Authorization: Bearer $OTHER_TOKEN"
```

### Install a skill from the registry

```bash
curl -X POST http://other-forge-instance:4000/registry/skills/networking.extreme-xco/1.0.0/install \
  -H "Authorization: Bearer $OTHER_TOKEN"

# The skill is downloaded, checksum-verified, and added to the local registry.
# Other agents on this instance can now use it immediately.
```

---

## 10. Approval Workflow

When an agent wants to perform a restricted action (defined in `conductBoundaries`), it triggers an approval request.

### Approval lifecycle

```
Agent attempts write:network action
  ↓
System checks charter.conductBoundaries
  ↓
Approval request created (status: PENDING)
  ↓
Notification sent (Telegram / Teams / WhatsApp)
  ↓
Operator: Approve or Deny
  ↓
If Approved: action executes, result returned to agent
If Denied:   action aborted, logged, agent notified
If Expired:  after 30 min, auto-denied, agent notified
```

### Check pending approvals

```bash
curl http://localhost:4000/approvals \
  -H "Authorization: Bearer $TOKEN" | jq '.data'

# [{
#   "id": "approval_xxx",
#   "requestId": "req_yyy",
#   "agentName": "XCO London Remediation",
#   "action": "Create VLAN 500 on fabric prod-fabric-1",
#   "status": "PENDING",
#   "expiresAt": "2024-01-15T15:30:00Z"
# }]
```

### Approve via API

```bash
curl -X POST http://localhost:4000/approvals/approval_xxx/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Approved — VLAN 500 is pre-approved for prod-fabric-1"}'
```

### Deny via API

```bash
curl -X POST http://localhost:4000/approvals/approval_xxx/deny \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Denied — changes require a maintenance window"}'
```

### Escalate a request manually

When the monitoring agent detects an issue and you want to trigger the remediation agent:

```bash
curl -X POST http://localhost:4000/requests/$REQUEST_ID/escalate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "'$REMEDIATION_ID'",
    "reason": "CRITICAL: Fabric member leaf-2 offline for 8 minutes"
  }'
```

---

## 11. Telegram Channel Integration

### Configure in bforge init

During `bforge init`, select **Telegram Bot** as your channel and enter:
- **Telegram Bot Token** (from [@BotFather](https://t.me/botfather))
- **Approval Chat ID** (your personal chat ID or a group for approvals)

Or add to `.env` manually:

```bash
TELEGRAM_BOT_TOKEN=7234567890:AAF...
TELEGRAM_APPROVAL_CHAT_ID=123456789
```

And start with the Telegram profile:

```bash
docker compose -f infra/docker-compose.yml --profile telegram up -d
```

### Interacting via Telegram

Send messages directly to your Forge bot:

```
You: /start

Bot: Welcome to Forge. I'm connected to 3 active agents:
     • XCO London Monitor
     • XCO Paris Monitor
     • K8s Production Sentinel

     What would you like to do?

You: How are all my XCO sites doing?

Bot: Checking all XCO agents...

     XCO London Monitor: ✅ Healthy — last check 12 min ago
       0 alarms | 3/3 fabric members online

     XCO Paris Monitor: ⚠️ Warning — last check 1 hr ago
       1 WARNING alarm on xe-0/0/1 (high error rate)
       1/3 fabric members degraded

     XCO Berlin Monitor: ❌ Not responding — last check 2.5 hrs ago
       Scheduler may have stopped. Try: /restart berlin

You: Can you fix the Paris alarm?

Bot: The remediation agent can investigate xe-0/0/1 on XCO Paris.
     This will require write access to the switch.

     [✅ Approve] [❌ Deny]

You: [taps Approve]

Bot: ✅ Approved. Remediation agent dispatched to XCO Paris...

     [5 minutes later]

Bot: XCO Paris remediation complete.
     xe-0/0/1 had excessive CRC errors from a faulty SFP.
     Port administratively shut down pending physical replacement.
     Alarm acknowledged and logged.
```

### Approval requests via Telegram

When any agent triggers an approval, you receive:

```
🔔 Approval Required

Agent: XCO London Remediation
Action: Create VLAN 600 (voice-traffic) on fabric prod-fabric-1
Requested by: scheduled job "XCO London — Network Expansion"
Expires: in 30 minutes

Details:
  • VLAN ID: 600
  • Name: voice-traffic
  • Tagged ports: xe-0/0/1 through xe-0/0/8

[✅ Approve] [❌ Deny] [📋 View Details]
```

---

## 12. Scheduled Monitoring & Escalation

### Cron expression reference

| Expression | Meaning |
|------------|---------|
| `0 * * * *` | Every hour at :00 |
| `*/15 * * * *` | Every 15 minutes |
| `0 8 * * 1-5` | Weekdays at 8:00 AM |
| `0 8 * * 1` | Every Monday at 8:00 AM |
| `0 0 * * *` | Daily at midnight |

### Create a scheduled job via API

```bash
curl -X POST http://localhost:4001/admin/scheduled-jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly XCO Summary Report",
    "description": "Every Monday morning — comprehensive fabric health summary",
    "agentId": "'$AGENT_ID'",
    "cronExpr": "0 8 * * 1",
    "input": "Generate a comprehensive weekly summary for all XCO sites. Include: total alarms last 7 days, uptime per fabric member, port utilisation trends, any remediation actions taken. Format as an executive report.",
    "enabled": true
  }'
```

### Escalation flow (automatic)

When a scheduled monitoring job detects an escalation trigger:

1. Monitoring agent flags: `CRITICAL: BGP session down on XCO London`
2. Scheduler calls `POST /requests/:id/escalate` with the remediation agent ID
3. Remediation agent receives context and runs diagnosis
4. Any write actions are gated by charter approval
5. Notification sent to your configured channel
6. All actions logged in the audit trail

### List scheduled jobs and their status

```bash
curl http://localhost:4001/admin/scheduled-jobs \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {name, cronExpr, enabled, lastRun: .updatedAt}'
```

### Toggle a job on/off

```bash
JOB_ID="job_xxxxxxx"
curl -X POST http://localhost:4001/admin/scheduled-jobs/$JOB_ID/toggle \
  -H "Authorization: Bearer $TOKEN"
```

---

## 13. Full API Reference

Base URL: `http://localhost:4000`
All endpoints require `Authorization: Bearer <token>` except `/health`, `/admin/setup/*`, and `/auth/login`.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Platform health check |
| `GET` | `/admin/setup/status` | Check if platform is configured |
| `POST` | `/admin/setup` | First-run bootstrap (creates admin, stores LLM key) |
| `POST` | `/auth/login` | Email + password → JWT |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Create an agent |
| `GET` | `/agents/:id` | Get agent details |
| `PATCH` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |
| `GET` | `/agents/:id/charter` | Get agent charter |
| `PUT` | `/agents/:id/charter` | Replace agent charter |
| `PATCH` | `/agents/:id/charter` | Partial charter update |

### Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills` | List all skills |
| `POST` | `/skills` | Create skill (system users only) |
| `GET` | `/skills/:id` | Get skill details |
| `POST` | `/skills/build` | Auto-build skill from knowledge sources |
| `POST` | `/skills/:id/test` | Run skill test suite |
| `POST` | `/skills/:id/publish` | Publish skill |
| `POST` | `/skills/discover` | Find skills by intent |

### Targets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/targets` | List targets |
| `POST` | `/targets` | Add target |
| `GET` | `/targets/:id` | Get target |
| `DELETE` | `/targets/:id` | Remove target |
| `POST` | `/targets/:id/verify-ssh` | Test SSH connectivity |
| `POST` | `/targets/:id/exec` | Execute SSH command |

### Credentials

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/credentials` | List credentials (names only, values encrypted) |
| `POST` | `/credentials` | Store new credential |
| `DELETE` | `/credentials/:id` | Delete credential |

### Requests

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/requests` | List recent requests |
| `POST` | `/requests` | Submit agent request |
| `GET` | `/requests/:id` | Get request + result |
| `POST` | `/requests/:id/escalate` | Escalate to another agent |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/approvals` | List pending approvals |
| `POST` | `/approvals/:id/approve` | Approve an action |
| `POST` | `/approvals/:id/deny` | Deny an action |

### Coordinator

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/coordinator/chat` | Send message to coordinator (supports sessions) |
| `POST` | `/coordinator/plan` | Generate a workflow plan from a goal |
| `GET` | `/coordinator/sessions` | List conversation sessions |
| `GET` | `/coordinator/sessions/:id` | Get session history |

### Personas

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/personas` | List personas |
| `GET` | `/personas/:id` | Get persona details |
| `POST` | `/personas/generate` | Generate persona from goal description |
| `POST` | `/personas/:id/spawn` | Spawn persona as live agent |
| `DELETE` | `/personas/:id` | Delete persona |

### Knowledge Store

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/knowledge` | List all knowledge domains |
| `GET` | `/knowledge/:domain` | List topics in domain |
| `GET` | `/knowledge/:domain/:topic` | Read a knowledge entry |
| `PUT` | `/knowledge/:domain/:topic` | Write a knowledge entry |
| `DELETE` | `/knowledge/:domain/:topic` | Delete a knowledge entry |
| `GET` | `/knowledge/:d1/:d2/constraints` | Check domain compatibility |

### Tools (Dynamic)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tools` | List dynamic tools |
| `GET` | `/tools/:name` | Get tool details |
| `POST` | `/tools` | Register a tool |
| `POST` | `/tools/generate` | Generate tool definition from description |
| `DELETE` | `/tools/:name` | Delete a tool |

### Domain Constraints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/constraints` | List all constraints |
| `POST` | `/constraints` | Register domain constraint |
| `DELETE` | `/constraints/:domain1/:domain2` | Remove constraint |

### Registry (Federated Skills)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/registry/skills` | Browse registry (optionally filtered) |
| `GET` | `/registry/skills/:domain/:version` | Get skill from registry |
| `POST` | `/registry/publish` | Publish skill to registry |
| `POST` | `/registry/skills/:domain/:version/install` | Install skill from registry |

---

## Environment Variables Reference

```bash
# Core (required)
DATABASE_URL=postgresql://forge:password@localhost:5432/forge
REDIS_URL=redis://localhost:6379
JWT_SECRET=64-char-hex-secret
CREDENTIAL_VAULT_KEY=64-char-hex-secret

# LLM (at least one required)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
AZURE_OPENAI_API_KEY=...
LLM_MODEL=gpt-4o

# Ports
PORT=4000               # API Gateway
DASHBOARD_PORT=3000     # Next.js Dashboard

# Knowledge Store
KNOWLEDGE_DIR=./knowledge   # Filesystem path for .md knowledge files

# Federated Skill Registry (optional)
SKILL_REGISTRY_URL=https://skills.your-org.com

# Telegram (optional)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_APPROVAL_CHAT_ID=...

# Microsoft Teams (optional)
TEAMS_WEBHOOK_URL=...

# WhatsApp / Twilio (optional)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_APPROVAL_TO=whatsapp:+44...

# Logging
LOG_LEVEL=info   # debug | info | warn | error
```

---

*Last updated: generated from platform v0.1.0*
