# BEX - Brendan's Exchange Forge

> Autonomous AI agents for your infrastructure — with secure credential management, human-in-the-loop approvals, and real-time notifications via Telegram, Teams, or WhatsApp.

---

## Get started in under 2 minutes

```bash
git clone https://github.com/your-org/bex
cd bex
make install   # build all packages + link bex CLI globally
bex init       # guided setup: LLM key → channel → integrations → launch
```

> **Requires:** Node.js 20+, Docker

`bex init` generates your `.env`, runs database migrations, seeds defaults, and starts everything. Dashboard is live at **http://localhost:3000**.

---

## How it works

Describe what you need in plain English. Forge creates an agent, teaches it the right skills by reading the relevant documentation, and runs it — handling approvals, credential security, and notifications automatically.

**Example: monitoring your wireless network**

1. Open the dashboard → **Personas** → describe your goal:
   > *"Monitor wireless access points for inactive radios, noise floor issues, and channel congestion. Alert me on Telegram."*

2. Forge generates a Persona, spawns a **Wireless Network Monitor** agent, and discovers the right skills from your configured integrations.

3. The agent runs on a schedule. When it finds a problem, it messages you:
   > *"3 radios inactive on floor 2. Noise floor elevated on channels 6 and 11. Would you like me to run diagnostics?"*

4. You reply **yes**. The agent proceeds, asks for approval before any writes, and posts a summary when done.
   > *"Diagnostics complete. Reply **dashboard** to create a live view of this data."*

---

## Key capabilities

| Capability | What it means |
|---|---|
| **Personas** | Describe a goal → Forge generates a full agent persona and spawns it into production |
| **Skill Engine** | Agents learn from documentation URLs — no manual tool coding required |
| **Credential Vault** | AES-256-GCM encryption; agents never see raw secrets; all calls proxied |
| **Approval Workflows** | Write ops and destructive actions require explicit human sign-off |
| **Agent Charter** | Per-agent posture: `AUTONOMOUS` / `SUPERVISED` / `INTERACTIVE` / `DELIBERATE` |
| **Skill Registry** | Version, test, publish, and share skills across Forge instances |
| **Coordinator** | Natural language routing across your entire agent pool via a single chat interface |
| **Domain Intelligence** | Agents get deep context from scraped docs + auto-generated playbooks — no RAG setup |
| **Dashboards** | Any agent producing data can create a live dashboard on demand |

---

## CLI

```bash
bex init      # first-run setup
bex start     # start all services
bex stop      # stop all services
bex status    # health check
bex logs      # tail all logs
bex logs api  # tail a specific service (api / worker / telegram / dashboard)
```

---

## Services

| Service | Port | Description |
|---|---|---|
| Dashboard | 3000 | Next.js management UI |
| API Gateway | 4000 | REST API — JWT auth, audit log |
| Dashboard API | 4001 | Admin REST API |
| Skill Registry | 5050 | Federated skill sharing |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Job queue (BullMQ) |

---

## Configuration

`bex init` and `make setup` auto-generate all secrets. At minimum you need one LLM key:

```bash
OPENAI_API_KEY=sk-...       # or ANTHROPIC_API_KEY
```

To receive notifications and approvals, add at least one channel:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_APPROVAL_CHAT_ID=...
```

See [`.env.example`](.env.example) for the full list of options.

---

## Documentation

- [Getting Started](docs/guides/getting-started.md)
- [Personas](docs/guides/personas.md)
- [Coordinator](docs/guides/coordinator.md)
- [Domain Intelligence](docs/architecture/domain-intelligence.md)
- [Architecture Overview](docs/architecture/overview.md)
- [CLI Reference](docs/guides/cli.md)

---

## Development

```bash
npm install       # install workspace dependencies
npm run dev       # start all services in watch mode
npm run test      # run all tests
npm run typecheck # type-check all packages
make db-studio    # open Prisma Studio
```

---

## License

MIT
