# Personas

A Persona is a goal-based template for creating agents. Instead of manually configuring system prompts, LLM models, and skill assignments, you describe what you want the agent to do in plain English — and the LLM generates a complete, ready-to-deploy configuration.

---

## What is a Persona?

A Persona stores:

| Field | Description |
|---|---|
| `name` | Auto-generated agent name |
| `goal` | The plain-text goal you provided |
| `systemPrompt` | LLM-generated system prompt tailored to the goal |
| `tone` | Communication style (e.g. `concise`, `analytical`, `professional`) |
| `skills` | Suggested skill domains (e.g. `["extremecloudiq.*"]`) |
| `schedule` | Suggested cron expression (e.g. `"0 * * * *"` for hourly) |
| `agentId` | Set after the persona is spawned into a live agent |

---

## Creating a Persona

### Via Dashboard

1. Go to **Personas → Generate Persona**
2. Enter a plain-text goal describing what you want the agent to do:
   ```
   Monitor ExtremeCloud IQ for new client devices joining the network.
   Track known clients in memory. Alert via Telegram when an unknown device
   is detected. Run every hour. Require approval before taking any action.
   ```
3. Click **Generate** — the LLM produces the full persona
4. Review the generated fields (you can edit any of them)
5. Click **Spawn Agent** to create a live, active agent from the persona

### Via API

```bash
# Step 1: Generate the persona
curl -X POST http://localhost:4000/personas/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Monitor ExtremeCloud IQ for new client devices and alert via Telegram when unknown devices join"
  }'
```

Response:
```json
{
  "ok": true,
  "data": {
    "id": "cm_abc123",
    "name": "XIQ Client Monitor",
    "goal": "Monitor ExtremeCloud IQ for new client devices...",
    "systemPrompt": "You are an ExtremeCloud IQ network monitoring agent...",
    "tone": "concise",
    "skills": ["extremecloudiq.clients", "extremecloudiq.devices"],
    "schedule": "0 * * * *",
    "agentId": null,
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

```bash
# Step 2: Spawn the agent
curl -X POST http://localhost:4000/personas/$PERSONA_ID/spawn \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "ok": true,
  "data": {
    "id": "cm_agent456",
    "name": "XIQ Client Monitor",
    "status": "ACTIVE",
    "personaId": "cm_abc123",
    ...
  }
}
```

---

## What Gets Generated

When you submit a goal, the LLM generates:

**System prompt** — a complete, role-specific system prompt including:
- Role definition and primary objective
- Behavioural guidelines (tone, verbosity, escalation conditions)
- Domain-specific hints (e.g. "use memory.md to track known clients")
- Output format instructions

**Tone** — the communication style, one of: `concise`, `analytical`, `professional`, `narrative`, `formal`

**Suggested skills** — domain patterns the agent will need (e.g. `extremecloudiq.*`, `networking.*`). These are suggestions — assign the actual published skills after spawning.

**Suggested schedule** — a cron expression if the goal implies recurring monitoring (e.g. `"0 * * * *"` for hourly). This is a suggestion — create the scheduled job separately.

---

## Spawning an Agent

`POST /personas/:id/spawn` creates an `ACTIVE` `Agent` record from the persona. The agent inherits:
- The generated system prompt (stored as `Agent.persona.systemPrompt`)
- The name from the persona
- `status: ACTIVE`
- `personaId` link back to the persona

**One-agent-per-persona:** Attempting to spawn a persona that already has an agent returns the existing agent — it does not create a duplicate. To reset, delete the agent first, then spawn again.

After spawning, complete the agent setup:
1. Assign the suggested skills (Agents → Edit → Skills tab)
2. Assign credentials (Agents → Edit → Credentials tab)
3. Optionally configure a charter (Agents → Edit → Charter tab)
4. Create a scheduled job if the persona suggested a schedule

---

## Example Personas

### XIQ Monitoring Agent

```
Goal: Monitor ExtremeCloud IQ hourly for disconnected APs and critical alarms.
Send a Telegram alert if anything needs attention. Use [NO_CHANGE] if all is well.
Require human approval before making any configuration changes.
```

Generated:
- **System prompt**: XIQ-specific monitoring agent with AP status checks
- **Tone**: `concise`
- **Suggested skills**: `extremecloudiq.devices`, `extremecloudiq.alarms`
- **Schedule**: `0 * * * *`

### New Device Detection Agent

```
Goal: Check ExtremeCloud IQ every 30 minutes for client devices that have not been
seen before. Track known devices in memory. Alert via Telegram when a new device joins.
Include the device MAC, hostname, and which AP it connected to.
```

Generated:
- **System prompt**: Client-tracking agent with memory instructions
- **Tone**: `analytical`
- **Suggested skills**: `extremecloudiq.clients`
- **Schedule**: `*/30 * * * *`

### Network Configuration Auditor

```
Goal: Once daily, audit the ExtremeCloud IQ configuration for policy drift — VLANs,
SSIDs, and network policies. Compare against memory of the last known-good state.
Report any differences. Do not make changes automatically.
```

Generated:
- **System prompt**: Audit-focused, read-only agent with policy comparison guidance
- **Tone**: `formal`
- **Suggested skills**: `extremecloudiq.vlans`, `extremecloudiq.ssids`, `extremecloudiq.policies`
- **Schedule**: `0 8 * * *` (8am daily)

---

## Charter Your Spawned Agent

After spawning, configure the agent's `AgentCharter` to define authority limits:

```bash
curl -X PUT http://localhost:4000/agents/$AGENT_ID/charter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mandate": "Monitor ExtremeCloud IQ for network health issues and alert when action is required.",
    "posture": "SUPERVISED",
    "bearing": "CONCISE",
    "verbosity": "STANDARD",
    "conductBoundaries": ["delete.*", "write:ssid", "write:vlan"],
    "escalationTriggers": ["severity:CRITICAL", "ap_offline_count:>5"]
  }'
```

Or via the dashboard under **Agents → Edit → Charter**.

---

## Managing Personas

```bash
# List all personas
GET /personas

# Get a specific persona
GET /personas/:id

# Delete a persona (does not delete the spawned agent)
DELETE /personas/:id

# List all personas (dashboard)
# Navigate to /personas
```

---

## Tips

- **Be specific in your goal.** The more concrete the goal, the better the generated system prompt. Include: the domain (XIQ, XCO), the trigger (hourly, on demand), the output channel (Telegram, dashboard), and any approval requirements.
- **Review the suggested schedule.** The LLM may suggest `*/5 * * * *` for "frequent" goals. Make sure the schedule is appropriate for your API rate limits.
- **Assign skills after spawning.** The persona's `skills` field lists suggested domains — you still need to assign the actual published `Skill` records to the agent.
- **Use the charter to constrain authority.** The spawned agent starts without a charter. Add one before activating in production to define posture and approval requirements.
