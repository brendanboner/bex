# Architecture Overview

Forge is a TypeScript monorepo of 15+ packages that collectively form an enterprise agentic platform. Agents receive messages via communication channels, route them through an orchestrator that selects the right tools and injects domain intelligence, execute against real APIs and systems, and return results — with approval gates on any destructive action.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Communication Channels                          │
│            Telegram · Teams · WhatsApp · Dashboard Chat · API        │
└──────────────────────────┬───────────────────────────────────────────┘
                           │  HTTP (JWT)
                  ┌────────▼────────┐
                  │   API Gateway   │  :4000
                  │  JWT auth       │  Rate limiting
                  │  Audit logging  │  Request queuing (BullMQ/Redis)
                  └────────┬────────┘
                           │  Job queue
          ┌────────────────┼─────────────────────────┐
          │                │                         │
 ┌────────▼────────┐  ┌────▼──────┐  ┌───────────────▼──────────────┐
 │   Coordinator   │  │ Scheduler │  │        Skill Engine          │
 │  AgentMesh      │  │ BullMQ    │  │  OpenAPI builder             │
 │  intent routing │  │ cron      │  │  discoverLinkedDocs()        │
 │  CoordinatorSess│  │[NO_CHANGE]│  │  generatePlaybooks()         │
 └────────┬────────┘  └───────────┘  │  Test runner                │
          │                          └──────────────────────────────┘
 ┌────────▼────────┐
 │  Orchestrator   │
 │  LLM execution  │
 │  Domain Intel   │  ← entity graph + playbook injection
 │  Skill learning │  ← learnedNotes injection
 │  Credential res │
 └────────┬────────┘
          │
  ┌───────┴──────────────────────────────────┐
  │                                          │
┌─▼──────────────────┐  ┌────────────────────▼──────────────┐
│  Credential Vault  │  │       Permission Gateway          │
│  AES-256-GCM       │  │  Approval workflows               │
│  HTTP proxy        │  │  Telegram/Teams/WhatsApp notif    │
│  SSH proxy         │  └───────────────────────────────────┘
└────────────────────┘
          │
┌─────────▼──────────┐   ┌───────────────────────────────────┐
│  SSH Executor      │   │          Persona Factory          │
│  ssh2 client       │   │  LLM-driven persona generation    │
│  createSshTool()   │   │  spawn Agent records from goals   │
└────────────────────┘   └───────────────────────────────────┘
          │
┌─────────▼──────────┐   ┌───────────────────────────────────┐
│     PostgreSQL     │   │    Skill Registry  :5050          │
│  Prisma ORM        │   │  Federated skill sharing          │
│  All platform state│   │  Push/pull across Forge instances │
└────────────────────┘   └───────────────────────────────────┘
```

---

## Package Map

```
packages/
├── api-gateway          # Fastify REST API — all routes, JWT auth, audit log
├── orchestrator         # Core: LLM execution, domain intel injection, skill learning
├── coordinator          # Smart gateway: AgentMesh routing, CoordinatorSession
├── scheduler            # BullMQ worker + cron loop; [NO_CHANGE] signal handling
├── skill-engine         # Skill discovery, OpenAPI builder, discoverLinkedDocs, generatePlaybooks
├── skill-registry-client# HTTP client for push/pull to central registry
├── credential-vault     # AES-256-GCM encryption + HTTP/SSH proxy service
├── ssh-executor         # SSH command execution (ssh2); createSshTool()
├── permission-gateway   # Approval gate: Telegram/Teams/WhatsApp notif + callback
├── persona-factory      # LLM-driven Persona generation from goal; spawn agents
├── knowledge-store      # Knowledge file CRUD (instructions/memory/context per agent)
├── agent-mesh           # Inter-agent routing, DomainConstraint registry, MeshEvent log
├── dashboard-api        # Admin REST API (status, users, scheduled jobs, endpoints)
├── shared               # Prisma schema, shared types, Zod schemas, ok()/err() helpers

integrations/
├── telegram             # grammY bot → api-gateway bridge
├── teams                # Microsoft Teams bot → api-gateway bridge
└── whatsapp             # Twilio WhatsApp → api-gateway bridge

apps/
└── dashboard            # Next.js 14 management UI
```

---

## Request Lifecycle

A message sent to the Telegram bot flows through the full stack as follows:

```
1. User sends message to Telegram bot
   ↓
2. integration-telegram — receives ctx.message.text
   Calls POST /requests {agentId, input, channel: "telegram"}
   ↓
3. API Gateway — validates JWT, creates AgentRequest{status: QUEUED}
   Enqueues job in BullMQ (Redis)
   ↓
4. Scheduler Worker — dequeues job
   Calls Orchestrator.execute(requestId, agentId, input)
   ↓
5. Orchestrator
   a. Loads agent from DB (skills, charter, persona, credential)
   b. Resolves credentials (prefix map → handler type → SYSTEM fallback)
   c. Builds system prompt:
      • AgentCharter mandate
      • Agent instructions.md + context.md + memory.md (from knowledge-store)
      • Skill system prompts + learnedNotes
      • DomainKnowledge entity graph (always injected)
      • Matching DomainKnowledge playbooks (≥2 trigger word matches)
   d. Builds tool set from active skills
   e. Calls LLM via Vercel AI SDK generateText() with maxSteps
   f. LLM calls tools iteratively (http_call, ssh_exec, skill_add_note, etc.)
   g. On write tools → permission check → if needs approval:
        Creates ApprovalRequest, sends approval channel notification
        Waits for POST /approvals/:id/approve or /deny
   h. Returns final text response
   ↓
6. AgentRequest updated: status=COMPLETED, output=<response>
   If output starts with [NO_CHANGE] → skip memory write + notification
   ↓
7. Telegram bot polls GET /requests/:id → sees COMPLETED
   Sends response back to user
```

---

## Orchestrator Deep Dive

The orchestrator is the intelligence core. Key responsibilities:

### Domain Intelligence Injection

Before every LLM call, the orchestrator enriches the system prompt with domain-level knowledge:

1. **Entity graph** — always injected. A compact relationship map of domain entities (e.g. `Client(mac_address) → AP(ap_id) → Location(location_id)`) that helps the LLM chain API calls correctly without hallucinating field names.
2. **Playbook matching** — trigger words from the user's query are matched against each playbook's `triggerPatterns`. If ≥2 words match, the playbook (step-by-step workflow) is injected into the prompt. This gives agents structured guidance for complex queries like "radio quality by location" or "VLAN to IP mapping".

Both are read from the `DomainKnowledge` table, keyed by domain string (e.g. `"extremecloudiq"`).

See [Domain Intelligence](domain-intelligence.md) for full details.

### Credential Resolution

The orchestrator resolves which vault credential to use for each skill tool via:
1. **Explicit prefix map** — e.g. `extremecloudiq → xiq`, `networking.extreme-xco → xco`
2. **Handler type detection** — `xiq_http_call` / `xco_http_call` in tool config
3. **Fallback** — any SYSTEM credential of matching type

### Skill Learning

Agents accumulate knowledge via the `skill_add_note` tool. When an agent discovers that a filter parameter is exact-match only, or that an API uses `unknown` for iPhone OS types, it calls:

```json
{"tool": "skill_add_note", "domain": "extremecloudiq.clients", "note": "os_type for iPhones is 'unknown' not 'iOS'"}
```

Notes are persisted to `Skill.learnedNotes` in Postgres and injected into every future system prompt for that domain. The agent never repeats the same mistake.

### Approval Gate

Write operations are checked against the agent's `AgentCharter.posture` and `conductBoundaries`. If approval is required, the orchestrator:
1. Pauses execution
2. Creates an `ApprovalRequest` record
3. Sends a formatted message to the approval channel (Telegram/Teams/WhatsApp)
4. Waits for `POST /approvals/:id/approve` or `/deny`

---

## Persona Factory

`@bclaw/persona-factory` generates agent configurations from a plain-text goal. Given:

```
"Monitor XIQ for new client devices and alert via Telegram"
```

The LLM produces a structured `Persona` record with system prompt, tone, suggested skills, and schedule. `POST /personas/:id/spawn` creates an `ACTIVE` `Agent` from the persona. One agent per persona (duplicate spawn guard).

See [Personas guide](../guides/personas.md).

---

## Coordinator

`@bclaw/coordinator` is the multi-agent orchestration layer. `POST /coordinator/chat` routes a query to the best-fit agent from the active pool using `AgentMesh` capability matching and `DomainConstraint` compatibility scores. Each routed task produces a `MeshEvent` record for observability.

See [Coordinator guide](../guides/coordinator.md).

---

## Agent Mesh

`@bclaw/agent-mesh` maintains the registry of active agent workers and their domain capabilities. Key responsibilities:
- `AgentMesh.route(task)` — selects the best-fit agent based on capability matching
- `DomainConstraint` registry — enforces domain-level constraints (e.g. read-only in production)
- `MeshEvent` log — every routed task creates an observability record

Set `MESH_AUTO_START_WORKERS=true` to auto-register all `ACTIVE` agents as mesh workers at startup.

---

## Knowledge Store

Each agent has a private knowledge directory with three special files:

| File | Injected As | Written By |
|---|---|---|
| `instructions.md` | `## Agent Instructions` | Human (dashboard) |
| `context.md` | `## Workspace Context` | Human (dashboard) |
| `memory.md` | `## Agent Memory` | Agent (`write_memory` tool) |

Memory is capped at 8000 chars (oldest content trimmed). Agents read their own memory via the `read_memory` tool and write persistent observations via `write_memory`.

---

## Security Model

| Layer | Mechanism |
|---|---|
| API auth | JWT (HS256) — all routes except `/health` |
| Credential storage | AES-256-GCM, key from `CREDENTIAL_VAULT_KEY` env var |
| Credential access | Agents never receive raw credentials — all calls proxied |
| SSH | Credentials injected at execution time, never logged |
| Approval callbacks | One-time tokens in callback URLs, expire after use |
| Registry admin | Bearer token (`REGISTRY_ADMIN_TOKEN`) for publish/delete |

---

## Skill Registry Federation

Any Forge instance can act as a skill registry (port 5050). Skills are:

- **Published** from skill-engine after build + test passes
- **Pushed** via `POST /skills/:id/publish-to-registry`
- **Pulled** by other Forge instances via `POST /registry/install/:domain/:version`
- **Verified** by checksum on install

Set `SKILL_REGISTRY_URL` to point instances at a shared central hub.
