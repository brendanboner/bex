# XCO Monitoring Agent Walkthrough

This guide walks through the complete journey from a fresh OpenClaw installation to a running XCO network monitoring agent.

---

## Prerequisites

- OpenClaw running (`make setup && make run`)
- An Extreme Networks XCO site with REST API access
- LLM API key configured (OpenAI, Anthropic, or Azure)
- Notification channel configured (Telegram, Teams, or WhatsApp)

---

## Step 1: Build the XCO Skill

The system has no XCO skill yet. You need to point it at the XCO API documentation.

### Via Dashboard (recommended)

1. Go to **Skills → Build Skill**
2. Fill in:
   - **Domain**: `networking.extreme-xco`
   - **Intent**: `Monitor Extreme Networks XCO fabric — detect alarms, configuration drift, and topology changes`
3. Add knowledge sources:
   - **OpenAPI URL**: `https://your-xco-host/api/openapi.json` (or upload the JSON)
   - **PDF URL**: Link to the XCO REST API guide PDF
   - **Markdown**: Any additional notes about your environment
4. Click **Build Skill**

The system will:
- Fetch and parse all sources
- Generate a comprehensive skill with tools like `get_devices`, `get_alarms`, `get_fabric_topology`, `create_vlan`, `get_port_stats`, `ssh_exec`
- Return a preview of the generated skill definition

### Via API

```bash
curl -X POST http://localhost:4000/skills/build \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "networking.extreme-xco",
    "intent": "Monitor Extreme Networks XCO fabric — detect alarms and configuration drift",
    "sources": [
      {
        "type": "openapi_url",
        "url": "https://your-xco-host/api/openapi.json",
        "label": "XCO REST API"
      },
      {
        "type": "pdf_url",
        "url": "https://extremenetworks.com/docs/xco-api-guide.pdf",
        "label": "XCO API Guide"
      }
    ]
  }'
```

---

## Step 2: Test the Skill

Before publishing, run the auto-generated test suite:

### Via Dashboard

In the skill detail view, click **Run Tests**. The system will:
- Generate test cases for each tool (using the LLM)
- Validate parameter schemas in dry-run mode
- Show a pass/fail report

### Via API

```bash
SKILL_ID="<skill-id-from-step-1>"

curl -X POST http://localhost:4000/skills/$SKILL_ID/test \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN"
```

Expected response:
```json
{
  "ok": true,
  "data": {
    "skillId": "...",
    "skillName": "XCO Network Skill",
    "passed": 14,
    "failed": 0,
    "skipped": 0,
    "cases": [...]
  }
}
```

---

## Step 3: Publish the Skill

Once tests pass:

```bash
curl -X POST http://localhost:4000/skills/$SKILL_ID/publish \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN"
```

The skill is now available to all agents.

### Optionally share with other openclaw instances

```bash
curl -X POST http://localhost:4000/skills/$SKILL_ID/publish-to-registry \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN"
```

This pushes the skill manifest (with SHA-256 checksum) to `SKILL_REGISTRY_URL`. Other instances can install it with:

```bash
curl -X POST http://other-instance:4000/registry/install/networking.extreme-xco/1.0.0 \
  -H "Authorization: Bearer $THEIR_ADMIN_TOKEN"
```

---

## Step 4: Add XCO Targets

Add the XCO devices/controllers you want to manage.

### Step 4a: Store credentials in the vault

```bash
curl -X POST http://localhost:4000/credentials \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "xco-london-creds",
    "description": "XCO London site admin credentials",
    "scope": "SYSTEM",
    "value": {
      "username": "admin",
      "password": "your-xco-password"
    },
    "allowedAgentPermissions": ["read:network", "write:network", "ssh:exec"]
  }'
```

### Step 4b: Add the target

```bash
CRED_ID="<credential-id-from-step-4a>"

curl -X POST http://localhost:4000/targets \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "xco-london",
    "description": "XCO London site controller",
    "hostname": "10.0.0.1",
    "sshPort": 22,
    "apiBaseUrl": "https://10.0.0.1:8443",
    "tags": ["xco", "london", "core"],
    "credentialId": "'$CRED_ID'"
  }'
```

### Step 4c: Verify SSH connectivity

```bash
TARGET_ID="<target-id-from-step-4b>"

curl -X POST http://localhost:4000/targets/$TARGET_ID/verify-ssh \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN"
```

---

## Step 5: Create the Monitoring Agent

```bash
curl -X POST http://localhost:4000/agents \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London Monitor",
    "description": "Hourly monitoring agent for the XCO London site",
    "llmProvider": "openai",
    "llmModel": "gpt-4o",
    "permissions": ["read:network", "ssh:exec"],
    "persona": {
      "tone": "concise",
      "outputFormat": "MonitoringResult"
    }
  }'
```

Assign the XCO skill to the agent:

```bash
AGENT_ID="<agent-id>"
curl -X PUT http://localhost:4000/agents/$AGENT_ID \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"skillIds": ["'$SKILL_ID'"], "status": "ACTIVE"}'
```

---

## Step 6: Schedule Hourly Monitoring

```bash
curl -X POST http://localhost:4001/scheduled-jobs \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London - Hourly Health Check",
    "description": "Check for alarms and drift every hour",
    "agentId": "'$AGENT_ID'",
    "cronExpr": "0 * * * *",
    "input": "Check the XCO London site. Report any alarms, fabric drift, or anomalies. Return a MonitoringResult.",
    "enabled": true
  }'
```

---

## Step 7: Set Up Escalation (Remediation Agent)

Create a separate remediation agent with write permissions:

```bash
curl -X POST http://localhost:4000/agents \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCO London Remediation",
    "description": "Fixes alarms detected by the monitoring agent",
    "llmProvider": "openai",
    "llmModel": "gpt-4o",
    "permissions": ["read:network", "write:network", "ssh:exec"],
    "persona": { "requireApproval": true }
  }'
```

When the monitoring agent detects issues, the scheduler will call `POST /requests/:id/escalate` to spawn the remediation agent. Any write operations (creating VLANs, modifying config) will trigger an approval request via your configured notification channel.

---

## Using the Agent

### Via Dashboard Chat
Go to `/chat`, select "XCO London Monitor", and ask:
- *"How is the XCO London site doing?"*
- *"What is the current fabric topology?"*
- *"Create a new fabric called 'prod-fabric-2' with these VLANs..."*

### Via Telegram/Teams/WhatsApp
Simply message your bot with the same questions. The agent will respond using the XCO skill.

### Via API
```bash
curl -X POST http://localhost:4000/requests \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "'$AGENT_ID'",
    "input": "What is the current state of the XCO London fabric? Any active alarms?",
    "channel": "api"
  }'
```

Poll the response:
```bash
REQUEST_ID="<request-id-from-above>"
curl http://localhost:4000/requests/$REQUEST_ID \
  -H "Authorization: Bearer $BCLAW_ADMIN_TOKEN"
```

---

## Approval Flow

When a write operation is requested:

1. Agent proposes the change (e.g., "Create VLAN 100 on fabric prod-fabric-1")
2. Approval request sent to your notification channel with Approve/Deny buttons
3. You approve → operation executes
4. You deny → operation aborted, logged
5. No response within 30 minutes → request expires

All decisions are stored in the audit log and visible in the dashboard.
