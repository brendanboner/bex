# Architecture Overview

Forge is a TypeScript monorepo of 14 packages that collectively form an enterprise agentic platform. Agents receive messages via communication channels, route them through an orchestrator that selects the right tools, execute against real APIs and systems, and return results — with approval gates on any destructive action.

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
          ┌────────────────┼─────────────────┐
          │                │                 │
 ┌────────▼────────┐  ┌────▼──────┐  ┌──────▼──────────┐
 │  Orchestrator   │  │ Scheduler │  │  Skill Engine   │
 │  Tool Router    │  │ Cron jobs │  │  OpenAPI builder│
 │  LLM execution  │  │ BullMQ    │  │  Skill testing  │
 │  Skill learning │  └───────────┘  │  Registry sync  │
 └────────┬────────┘                 └─────────────────┘
          │
  ┌───────┴──────────────────────────┐
  │                                  │
┌─▼──────────────────┐  ┌────────────▼──────────────┐
│  Credential Vault  │  │    Permission Gateway     │
│  AES-256-GCM       │  │    Approval workflows     │
│  SSH proxy         │  │    Telegram/Teams/WA notif│
│  Type-safe access  │  └───────────────────────────┘
└─▼──────────────────┘
  │
┌─▼──────────────────┐   ┌─────────────────────────┐
│     PostgreSQL     │   │     Skill Registry      │
│  All platform state│   │  :5050 — federated hub  │
│  Prisma ORM        │   │  Push/pull across Forge │
└────────────────────┘   │  instances              │
                         └─────────────────────────┘
```

---

## Package Map

```
packages/
├── api-gateway          # Fastify REST API — agents, skills, requests, credentials
├── orchestrator         # Core: tool routing, LLM execution, skill learning
├── scheduler            # BullMQ worker + cron loop for scheduled agents
├── skill-engine         # Skill discovery, OpenAPI builder, testing, registry sync
├── skill-registry       # Standalone registry server (Express + SQLite)
├── skill-registry-client# HTTP client for publishing/pulling skills
├── credential-vault     # AES-256-GCM encryption + SSH proxy service
├── permission-gateway   # Approval gate: Telegram/Teams/WhatsApp notif + callback
├── knowledge-store      # Knowledge source ingestion (PDF, URL, text)
├── persona-factory      # Agent persona templates
├── agent-mesh           # Inter-agent message bus (MeshEvent table)
├── coordinator          # Smart routing between specialist agents
├── ssh-executor         # SSH command execution with credential proxy
├── shared               # Prisma schema, shared types, Zod schemas
│
integrations/
├── telegram             # grammY bot — primary chat interface
├── teams                # Microsoft Teams bot adapter
└── whatsapp             # Twilio WhatsApp adapter
│
apps/
└── dashboard            # Next.js 14 dashboard UI
```

---

## Request Lifecycle

A message sent to the Telegram bot flows through the full stack as follows:

```
1. User sends message to Telegram bot
   ↓
2. bot.ts — receives ctx.message.text
   Calls POST /requests {agentId, input, channel: "telegram"}
   ↓
3. API Gateway — validates JWT, creates AgentRequest{status: QUEUED}
   Enqueues job in BullMQ (Redis)
   ↓
4. Scheduler Worker — dequeues job
   Calls Orchestrator.run(requestId, agentId, input)
   ↓
5. Orchestrator
   a. Loads agent from DB (skills, charter, persona, credential)
   b. Tool Router — classifies domain (XIQ/XCO/weather/utility)
                     selects 25 tools (tier 1 by default)
                     checks reachability of base URLs
   c. Builds system prompt (charter + persona + skill prompts + learnedNotes)
   d. Calls LLM with tools via AI SDK streamText()
   e. LLM calls tools iteratively (xciq_http_call, ssh_exec, skill_add_note, etc.)
   f. On write tools → permission check → if needs approval:
        Creates ApprovalRequest, sends Telegram notification
        Waits for approval webhook (POST /approvals/:id/approve|deny)
   g. Returns final text response
   ↓
6. AgentRequest updated: status=COMPLETED, output=<response>
   ↓
7. Telegram bot polls GET /requests/:id → sees COMPLETED
   Sends response back to user
```

---

## Orchestrator Deep Dive

The orchestrator is the intelligence core. Key responsibilities:

### Tool Selection (Tool Router)

The naive approach — sending all 588 tools to the LLM — hits OpenAI's 128-tool limit. The tool router solves this:

1. **Domain classification** — scores the user's message against domain keyword maps (XIQ, XCO, weather, utility). Uses last 6 messages for context continuity.
2. **Tier selection** — classifies tools as T1 (read/list), T2 (write/configure), T3 (destructive). Only loads T2/T3 if the message has write/delete intent.
3. **Availability gating** — skips domains whose base URL is unreachable (cached for 5 min). Prevents long timeouts on private VPN tools.
4. **Result** — typically 25 tools selected from 588 total.

### Skill Learning

Agents accumulate knowledge via the `skill_add_note` tool. When an agent discovers that a filter parameter is exact-match only, or that an API uses `unknown` for iPhone OS types, it calls:

```json
{"tool": "skill_add_note", "domain": "extremecloudiq.clients", "note": "os_type for iPhones is 'unknown' not 'iOS'"}
```

Notes are persisted to `Skill.learnedNotes` in Postgres and injected into every future system prompt for that domain. The agent never repeats the same mistake.

### Approval Gate

Write operations (POST/PUT/PATCH/DELETE via any skill tool) are checked against the agent's `requiresApprovalForWrites` flag. If set, the orchestrator:
1. Pauses execution
2. Creates an `ApprovalRequest` record
3. Sends a formatted message to the approval channel (Telegram/Teams/WhatsApp)
4. Waits for POST `/approvals/:id/approve` or `/approvals/:id/deny`

---

## Security Model

| Layer | Mechanism |
|---|---|
| API auth | JWT (HS256) — all routes except `/health` and `/admin/setup` |
| Credential storage | AES-256-GCM, key from `CREDENTIAL_VAULT_KEY` env var |
| Credential access | Agents never receive raw credentials — all calls proxied |
| SSH | Credentials injected at execution time, never logged |
| Approval callbacks | One-time tokens in callback URLs, expire after use |
| Registry admin | Bearer token (`REGISTRY_ADMIN_TOKEN`) for publish/delete |
| Skill registry | Public read, authenticated write/delete |

---

## Skill Registry Federation

Any Forge instance can act as a skill registry (port 5050). Skills are:

- **Published** from skill-engine after build + test passes
- **Pulled** by other Forge instances via `SKILL_REGISTRY_URL`
- **Deleted** only by admin token holders

This allows a team to maintain a central skill hub that all their Forge deployments pull from — one team builds the XIQ skill, everyone benefits.
