# Forge — Enterprise Agentic Platform

**Autonomous domain agents with secure credential management, domain intelligence, federated skill sharing, and human-in-the-loop approval workflows.**

---

## Quickstart

```bash
git clone https://github.com/your-org/bex
cd bex
make install     # npm install + build all packages + link bex globally
bex init         # interactive setup wizard
```

> **Prerequisites:** Node.js 20+, Docker (running)

`bex init` guides you through:
1. LLM provider + API key (validated live)
2. Interface channel (Web Dashboard / Telegram / Teams / WhatsApp)
3. Optional network integrations (ExtremeCloud IQ, XCO)
4. Admin account creation
5. Generates `.env`, runs migrations, seeds data, starts everything via pm2

Dashboard is live at **http://localhost:3000** when done.

---

## CLI Reference

```bash
bex init       # First-run setup wizard
bex start      # Start all services (pm2 + Docker infra)
bex stop       # Stop all services
bex restart    # Restart all services
bex status     # Health check all services
bex logs       # Tail all service logs
bex logs api   # Tail API gateway logs only
bex logs worker
bex logs telegram
bex logs dashboard
```

> If `bex` is not in your PATH after install, run `make install` from the repo root or use `npm run bex -- <command>`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Communication Channels                          │
│            Telegram · Teams · WhatsApp · Dashboard Chat · API        │
└──────────────────────────┬───────────────────────────────────────────┘
                           │  HTTP (JWT)
                  ┌────────▼────────┐
                  │   API Gateway   │  :4000 — JWT auth, audit log, rate limit
                  └────────┬────────┘
                           │  BullMQ / Redis
          ┌────────────────┼────────────────────┐
          │                │                    │
 ┌────────▼────────┐  ┌────▼──────┐  ┌──────────▼──────────┐
 │   Coordinator   │  │ Scheduler │  │    Skill Engine     │
 │  AgentMesh      │  │ BullMQ    │  │  Discovery + build  │
 │  intent routing │  │ cron      │  │  Doc link scraping  │
 └────────┬────────┘  └───────────┘  │  Playbook generation│
          │                          └─────────────────────┘
 ┌────────▼────────┐
 │  Orchestrator   │
 │  LLM execution  │
 │  Domain Intel   │  ← injects entity graphs + playbooks
 │  Skill learning │
 └────────┬────────┘
          │
  ┌───────┴──────────────────────────┐
  │                                  │
┌─▼──────────────────┐  ┌────────────▼──────────────┐
│  Credential Vault  │  │    Permission Gateway     │
│  AES-256-GCM       │  │    Approval workflows     │
│  HTTP + SSH proxy  │  │    Telegram/Teams/WA      │
└────────────────────┘  └───────────────────────────┘
          │
┌─────────▼──────────┐   ┌───────────────────────────┐
│  SSH Executor      │   │    Persona Factory        │
│  ssh2 client       │   │    LLM-driven persona gen │
│  createSshTool()   │   │    spawn Agent records    │
└────────────────────┘   └───────────────────────────┘
          │
┌─────────▼──────────┐   ┌───────────────────────────┐
│     PostgreSQL     │   │  Skill Registry  :5050    │
│  Prisma ORM        │   │  Federated skill sharing  │
└────────────────────┘   └───────────────────────────┘
```

---

## Key Concepts

### Personas
Describe a goal in plain English — the LLM generates a structured Persona (system prompt, tone, suggested skills, schedule). Spawn it into a running agent with one click. See [Personas guide](docs/guides/personas.md).

### Domain Intelligence Layer
When a skill is built from a URL, Forge automatically:
1. Scrapes the source domain for all linked documentation (API guides, CLI refs, release notes)
2. Generates 1–3 analysis playbooks for complex multi-step workflows
3. Stores everything in `DomainKnowledge` and injects it into agent prompts at runtime

This gives every agent deep domain awareness without RAG or manual curation. See [Domain Intelligence](docs/architecture/domain-intelligence.md).

### Skill Registry
Skills are versioned (`DRAFT → PENDING_REVIEW → PUBLISHED → DEPRECATED`), tested, and published. Any Forge instance can share skills via `SKILL_REGISTRY_URL`.

### Credential Vault
All credentials are AES-256-GCM encrypted. Agents never see raw secrets — all API calls and SSH sessions are proxied through the vault.

### Approval Workflows
Write operations, skill publishing, and remediation actions require explicit human approval via your configured channel (Telegram / Teams / WhatsApp) before executing.

### Agent Charter System
Every agent has an optional `AgentCharter` with a `posture`:
- **AUTONOMOUS** — acts independently, notifies on completion
- **SUPERVISED** — approval gates for writes and destructive ops
- **INTERACTIVE** — confirms before each significant action
- **DELIBERATE** — analysis only; awaits explicit instruction before each step

### Coordinator
`POST /coordinator/chat` routes a query to the best-fit agent from the active pool using `AgentMesh` capability matching. See [Coordinator guide](docs/guides/coordinator.md).

### Agent Memory
Each agent has `instructions.md`, `context.md`, and `memory.md` knowledge files. Memory is written by the agent at runtime (`write_memory` tool), capped at 8000 chars, and injected into every system prompt.

### [NO_CHANGE] Signal
Scheduled monitoring agents output `[NO_CHANGE]` when nothing has changed. The scheduler skips memory writes and Telegram notifications — preventing alert fatigue.

---

## Services

| Service | Port | Description |
|---|---|---|
| dashboard | 3000 | Next.js 14 management UI |
| api-gateway | 4000 | Main REST API (JWT auth) |
| dashboard-api | 4001 | Admin REST API |
| skill-registry | 5050 | Federated skill sharing hub |
| PostgreSQL | 5432 | Primary database (Prisma ORM) |
| Redis | 6379 | BullMQ job queue |

---

## Configuration

**Minimum required:**
```bash
OPENAI_API_KEY=sk-...        # or ANTHROPIC_API_KEY
JWT_SECRET=...               # auto-generated by bex init / make setup
CREDENTIAL_VAULT_KEY=...     # 64 hex chars — auto-generated
POSTGRES_PASSWORD=...        # auto-generated
REDIS_PASSWORD=...           # auto-generated
```

**Notification channels (at least one recommended):**
```bash
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_APPROVAL_CHAT_ID=...

# Microsoft Teams
TEAMS_APPROVAL_WEBHOOK_URL=...

# WhatsApp (Twilio)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_APPROVAL_TO=whatsapp:+1234567890
```

See [`.env.example`](.env.example) for the full reference.

---

## Development

```bash
npm install          # install all workspace dependencies
npm run build        # build all packages (Turborepo)
npm run dev          # start all services in watch mode
npm run typecheck    # type-check all packages
npm run lint         # ESLint across all packages
npm run test         # run all tests
make db-studio       # open Prisma Studio
```

---

## Documentation

Full docs are in [`docs/`](docs/README.md):

- [Getting Started](docs/guides/getting-started.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Domain Intelligence](docs/architecture/domain-intelligence.md)
- [Personas](docs/guides/personas.md)
- [Coordinator](docs/guides/coordinator.md)
- [CLI Reference](docs/guides/cli.md)
- [ExtremeCloud IQ Example](docs/examples/extremecloudiq-setup.md)

---

## License

MIT
