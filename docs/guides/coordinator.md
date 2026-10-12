# Coordinator

The Coordinator is Forge's multi-agent orchestration layer. Instead of routing every request to a single configured agent, the Coordinator selects the best-fit agent from the active pool based on their skills and domain capabilities.

---

## When to Use the Coordinator

| Scenario | Use |
|---|---|
| You know which agent to use | `POST /requests` with `agentId` |
| You want the system to pick the best agent | `POST /coordinator/chat` |
| Complex workflow spanning multiple domains | `POST /coordinator/chat` |
| Building a chat interface without per-agent routing | `POST /coordinator/chat` |

The Coordinator is the right choice when you have a pool of specialist agents (XIQ monitor, XCO auditor, general assistant) and want requests automatically routed to the one best equipped to handle them.

---

## POST /coordinator/chat

Routes a query to the best-fit agent and returns a `CoordinatorSession`.

**Request:**
```bash
curl -X POST http://localhost:4000/coordinator/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Show me all disconnected APs in ExtremeCloud IQ",
    "channel": "api"
  }'
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "sessionId": "cm_sess123",
    "agentId": "cm_xiq_agent",
    "agentName": "XIQ Network Monitor",
    "output": "Found 2 disconnected APs:\n• FrontAP3000 — offline 47 min\n• WH-AP5010 — offline 3 hours",
    "channel": "api",
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | string | ✓ | The user's query |
| `channel` | string | ✓ | `api` \| `telegram` \| `teams` \| `dashboard` |
| `agentId` | string | — | Override auto-routing; force a specific agent |

---

## GET /coordinator/sessions/:id

Retrieve a coordinator session by ID.

```bash
curl http://localhost:4000/coordinator/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "cm_sess123",
    "input": "Show me all disconnected APs",
    "agentId": "cm_xiq_agent",
    "channel": "api",
    "createdAt": "2026-05-01T10:00:00Z"
  }
}
```

---

## How Agent Selection Works

The Coordinator uses `AgentMesh` to select the best-fit agent. The routing process:

### 1. Capability Matching

Each `ACTIVE` agent is scored against the incoming query based on:
- **Skill domains** — does the agent have skills matching the query's domain keywords?
- **Permissions** — does the agent have the permissions needed for the requested operation?

### 2. DomainConstraint Filtering

`DomainConstraint` records define hard constraints on which agents can handle which domains. For example, a read-only constraint on the production XIQ domain prevents write-capable agents from being selected for read-only contexts.

```bash
# Create a domain constraint
curl -X POST http://localhost:4000/constraints \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "extremecloudiq",
    "constraint": "read-only",
    "agentId": "cm_agent_readonly"
  }'
```

### 3. Agent Selection

The agent with the highest combined score is selected. If no agents match, the request falls back to the `isDefault: true` agent (the "Forge Assistant").

---

## CoordinatorSession Lifecycle

```
POST /coordinator/chat
  ↓
AgentMesh.route(input) → scores all ACTIVE agents → selects best-fit
  ↓
Creates CoordinatorSession { id, input, agentId, channel }
  ↓
Orchestrator.execute(agentId, input)
  ↓
AgentRequest created → BullMQ → worker → LLM execution
  ↓
CoordinatorSession includes output when complete
```

The `CoordinatorSession` records which agent was selected and why. `MeshEvent` records provide a detailed observability log for every routing decision.

---

## AgentMesh Observability

Every routing decision creates a `MeshEvent` record:

```bash
# View recent mesh events (via dashboard-api)
curl http://localhost:4001/mesh/events \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Each event includes:
- `type` — `task_assigned`, `task_completed`, `alert`, `approval_needed`
- `fromAgent` — the Coordinator
- `toAgent` — the selected specialist agent
- `payload` — routing scores and selection reason

---

## Auto-Start Mesh Workers

Set `MESH_AUTO_START_WORKERS=true` in `.env` to automatically register all `ACTIVE` agents as AgentMesh workers at startup. This means new agents become routable immediately without manual registration.

---

## Dashboard: Nexus Chat

The **Nexus** page (`/chat`) in the dashboard uses the Coordinator internally. Every message you send is routed through `POST /coordinator/chat` — you do not need to select an agent manually. The interface shows which agent handled each message.

---

## DynamicTool Registry

Agents can also be extended with `DynamicTool` records — manually-defined tools not generated from OpenAPI specs.

```bash
# Create a dynamic tool
POST /tools
{
  "name": "check_vpn_reachability",
  "description": "Ping a VPN endpoint and return reachability status",
  "handlerType": "public_http_call",
  "config": { "method": "GET", "urlTemplate": "https://vpn.example.com/health" },
  "parameters": {}
}

# List tools
GET /tools

# Assign to agent via the Skills/Tools tab in dashboard
```

Dynamic tools are available to any agent they are assigned to and appear alongside skill tools during LLM execution.

---

## Example: Multi-Domain Routing

With a pool of specialist agents:

| Agent | Skills | Handles |
|---|---|---|
| XIQ Monitor | `extremecloudiq.*` | XIQ device/client queries |
| XCO Auditor | `xco.*` | XCO fabric and switch queries |
| Forge Assistant | all published | General and cross-domain queries |

Queries are automatically routed:

```
"Show disconnected APs in XIQ"     → XIQ Monitor
"Check XCO fabric health"          → XCO Auditor  
"What agents do I have configured?" → Forge Assistant
"Compare XIQ and XCO alarm counts"  → Forge Assistant (cross-domain)
```
