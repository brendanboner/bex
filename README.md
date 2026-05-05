# BEX - Brendan's Exchange Forge

> Autonomous AI agents for your infrastructure — with secure credential management, human-in-the-loop approvals, and real-time notifications via Telegram, Teams, or WhatsApp.

---

## Install

**Requires:** Node.js 20+ and Docker

```bash
curl -fsSL https://raw.githubusercontent.com/extremenetworks-emu/bex/main/install.sh | bash
```

The script checks your prerequisites, clones the repo, builds everything, and launches the setup wizard. Dashboard is live at **http://localhost:3000** when done.

> **Deploying to a server?** Skip down to [Server / VPS (full Docker)](#server--vps-full-docker).

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

## Server / VPS (full Docker)

No Node.js required on the host — everything runs in containers.

```bash
git clone https://github.com/extremenetworks-emu/bex.git
cd bex
cp .env.docker.example .env
# edit .env — set OPENAI_API_KEY and your channel tokens
docker compose up -d
```

With Telegram:

```bash
docker compose --profile telegram up -d
```

The `migrate` container runs `prisma migrate deploy` automatically before the API starts — no manual migration step.

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

Running `curl … | bash` or `bex init` generates all secrets automatically. You only need to supply:

**An LLM key** (at least one):
```bash
OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, AZURE_OPENAI_API_KEY, OLLAMA_BASE_URL
```

**A notification channel** (recommended — needed for approvals and agent alerts):
```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_APPROVAL_CHAT_ID=...
```

For the full Docker path, see [`.env.docker.example`](.env.docker.example). For the Node hybrid path, see [`.env.example`](.env.example).

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
