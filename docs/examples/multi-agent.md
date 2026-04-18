# Example: Multi-Agent Orchestration

Forge supports multi-agent patterns: a coordinator agent routes requests to specialist agents, and agents can spawn each other for complex tasks.

---

## Pattern: Coordinator + Specialists

```
User
  │
  ▼
┌─────────────────────────────────┐
│         Coordinator Agent       │
│  "Forge Assistant"              │
│  - Routes to correct specialist │
│  - Aggregates results           │
│  - Handles context switching    │
└──────┬──────────┬───────────────┘
       │          │
       ▼          ▼
┌──────────┐  ┌──────────────────┐
│  XIQ     │  │  XCO Monitor     │
│  Agent   │  │  Agent           │
│          │  │                  │
│ All XIQ  │  │ Read-only XCO    │
│ skills   │  │ + SSH            │
└──────────┘  └──────┬───────────┘
                     │ (escalates)
                     ▼
              ┌──────────────────┐
              │  XCO Remediation │
              │  Agent           │
              │  Write + SSH     │
              │  (approval gate) │
              └──────────────────┘
```

---

## Setting Up the Coordinator

### Create the Coordinator Agent

```
Create a coordinator agent called "Forge Assistant":
- LLM: gpt-4o
- Skills: none (the coordinator routes, not executes)
- Mode: coordinator
- Routes to: XIQ Agent, XCO Monitor
```

Or via the dashboard: **Agents → New Agent → Type: Coordinator**

### Configure Routing Rules

The coordinator uses semantic routing — it reads the user's message and decides which specialist to invoke. You can add explicit rules:

```
Configure Forge Assistant routing:
- Messages about wireless, clients, SSIDs, APs → XIQ Agent
- Messages about fabric, switches, BGP, VLAN on XCO → XCO Monitor
- Messages about fixing, remediating, changing XCO → XCO Remediation
- General questions → answer directly
```

---

## Pattern: Monitor + Remediation

The most common multi-agent pattern in network operations:

```
1. Monitor agent runs on schedule
2. Detects issue
3. Spawns remediation agent with context
4. Remediation agent proposes fix
5. Human approves via Telegram/Teams
6. Remediation executes
7. Monitor verifies fix on next run
```

### Setting Up the Handoff

In the XCO Monitor agent charter:
```json
{
  "escalation": {
    "channel": "telegram",
    "spawnAgent": "XCO Remediation",
    "triggerCondition": "any_critical_alarm OR offline_switch",
    "handoffContext": "Include: alarm details, affected devices, proposed fix"
  }
}
```

When the monitor spawns the remediation agent, it passes the full context:

```
[XCO Monitor → XCO Remediation]

Context handed off:
  - SW-LEAF-03: BGP session down with 10.0.0.1 for 23 minutes
  - Last known good config: [BGP config snapshot]
  - Proposed fix: Verify BGP timer config, check if peer is reachable
  - Monitor will verify on next hourly run
```

---

## Pattern: Parallel Domain Queries

For questions that span multiple domains, the coordinator fans out:

```
User: "Give me a health summary of everything — XIQ and XCO"
  │
  ├── XIQ Agent: "Summarise XIQ health: devices, clients, alarms"
  │     └── Response: "47 devices online, 203 clients, 0 alarms"
  │
  └── XCO Agent: "Summarise XCO health: switches, BGP, alarms"
        └── Response: "10 switches online, all BGP sessions up, 0 alarms"
  │
  ▼
Coordinator: Aggregates → "Network Health Summary:
  XIQ: 47 APs online, 203 clients connected, no alarms ✅
  XCO: 10 fabric switches, all BGP sessions healthy, no alarms ✅
  Overall: All systems nominal."
```

---

## MeshEvent Bus

Agents communicate via the `MeshEvent` table. This enables asynchronous handoffs that survive agent restarts:

```typescript
// Monitor posts an event
await prisma.meshEvent.create({
  data: {
    type: 'task_assigned',
    fromAgent: monitorAgentId,
    toAgent: remediationAgentId,
    payload: {
      alarm: { id: 'ALM-001', severity: 'critical', device: 'SW-LEAF-03' },
      proposedFix: '...',
      approvalRequired: true,
    },
  },
});
```

The remediation agent's worker polls for unprocessed mesh events and picks up the task.

---

## Example Conversation

With the coordinator as the default Telegram agent, a user can ask about anything without knowing which specialist handles it:

```
User: "How many clients are on FrontAP3000?"
Agent: "FrontAP3000 currently has 23 connected clients..."
  (routed to XIQ Agent transparently)

User: "Is the XCO fabric healthy?"
Agent: "Checking XCO fabric... All 10 switches online, 0 alarms, all BGP sessions healthy."
  (routed to XCO Monitor)

User: "Something's wrong with SW-LEAF-03's BGP"
Agent: "I can see SW-LEAF-03 has a BGP session down with 10.0.0.1 (since 14:23).
        I'll hand this to the remediation agent for a fix proposal..."
  (escalated to XCO Remediation, approval request sent)
```

---

## Creating Agents Programmatically

For CI/CD or automation scripts:

```bash
# Create a specialist agent
curl -X POST http://localhost:4000/agents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XIQ Agent",
    "llmProvider": "openai",
    "llmModel": "gpt-4o",
    "permissions": ["read:network", "write:network"],
    "skillDomains": ["extremecloudiq.devices", "extremecloudiq.clients"],
    "credentialId": "cred-xiq-production",
    "status": "ACTIVE"
  }'

# Assign a charter
curl -X POST http://localhost:4000/agents/:id/charter \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XIQ Read-Write Charter",
    "constraints": {
      "requireApprovalFor": ["delete", "bulk_update"],
      "allowedDomains": ["extremecloudiq.*"]
    }
  }'
```
