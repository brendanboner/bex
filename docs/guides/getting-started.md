# Getting Started

This guide takes you from a fresh clone to a working BEX instance with an agent responding in Telegram in under 15 minutes.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 20+ | Use nvm: `nvm use 20` |
| Docker | 24+ | For Postgres + Redis |
| LLM API key | — | OpenAI, Anthropic, or Azure OpenAI |
| (Optional) Telegram bot | — | Create via [@BotFather](https://t.me/BotFather) |

---

## Step 1 — Clone and Install

```bash
git clone https://github.com/your-org/bex
cd bex
npm install
```

---

## Step 2 — Start Infrastructure

```bash
# Start PostgreSQL and Redis via Docker
make dev
```

This starts `docker-compose.dev.yml` — just Postgres and Redis, no application containers.

---

## Step 3 — Run the Setup Wizard

```bash
npx bex init
```

The wizard will ask for:

1. **LLM Provider** — OpenAI / Anthropic / Azure OpenAI
2. **API key** — validated live against the provider
3. **LLM model** — e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`
4. **Admin password** — for the dashboard
5. **Notification channel** — Telegram / Teams / WhatsApp / None

At the end, `bex init` will:
- Write a `.env` file with all generated secrets
- Run Prisma migrations
- Seed the database with a system user and default agent
- Start all services

---

## Step 4 — Verify Services are Running

```bash
bex status
```

Expected output:
```
✔ skill-registry  :5050  healthy
✔ api-gateway     :4000  healthy
✔ dashboard-api   :4001  healthy
✔ worker          —      running
✔ telegram-bot    —      running   (if configured)
```

---

## Step 5 — Open the Dashboard

Navigate to **http://localhost:3000** and log in with the admin credentials you set in Step 3.

The dashboard gives you:
- **Agents** — create and configure AI agents
- **Skills** — browse, build, and manage skill libraries
- **Credentials** — securely store API keys, passwords, SSH keys
- **Targets** — network devices and systems
- **Requests** — live request history and status
- **Scheduled Jobs** — cron-based monitoring agents
- **Settings** — LLM config, notification channels, registry

---

## Step 6 — Send Your First Message

If you configured Telegram, send a message to your bot:

```
What skills do you currently have loaded?
```

Expected response:
```
I have the following skills loaded:
• ExtremeCloud IQ — Devices (25 tools)
• ExtremeCloud IQ — Clients (12 tools)
...
```

Or use the dashboard chat interface directly.

---

## Step 7 — Create Your First Agent

In the dashboard, go to **Agents → New Agent**:

| Field | Example |
|---|---|
| Name | `Network Monitor` |
| LLM Model | `gpt-4o` |
| Permissions | `read:network` |

Or ask in the chat:
```
Create an agent called "Network Monitor" for monitoring ExtremeCloud IQ
```

---

## Step 8 — Build a Skill (Optional)

If you want to add capabilities for a new API:

```
Build a skill from the OpenAPI spec at https://api.example.com/openapi.json
```

The platform will:
1. Fetch and parse the OpenAPI spec
2. Group operations by tag into skill domains
3. Generate tool definitions for each operation
4. Build a rich system prompt (pagination hints, search patterns, write safety)
5. Run automated tests
6. Ask for approval before publishing to the registry

---

## Common First Tasks

| What you want to do | How |
|---|---|
| List all connected devices | "List all devices" |
| Find a specific device | "Find the device named AP5010" |
| Schedule hourly monitoring | Go to Scheduled Jobs → New Job → cron `0 * * * *` |
| Store an API key | Dashboard → Credentials → New Credential |
| Assign credentials to agent | Dashboard → Agent → Edit → Credentials |
| See what tools the agent has | `/tools` in Telegram, or Dashboard → Agent → Tools |
| Build a skill from API docs | "Build a skill from https://..." |

---

## Troubleshooting

**Services won't start:**
```bash
bex status          # check which service is unhealthy
bex logs api        # tail api-gateway logs
bex logs worker     # tail worker logs
```

**Telegram bot not responding:**
```bash
bex logs telegram   # check for errors
# Ensure TELEGRAM_BOT_TOKEN and TELEGRAM_DEFAULT_AGENT_ID are set in .env
```

**LLM errors:**
- Check `OPENAI_API_KEY` is set and valid
- Check the model name is correct (e.g. `gpt-4o` not `gpt4o`)
- For Azure: ensure `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` are set

**Database errors:**
```bash
# Re-run migrations
cd packages/shared && npx prisma migrate deploy

# Reset database (⚠️ deletes all data)
cd packages/shared && npx prisma migrate reset
```

**Port already in use:**
```bash
# Find and kill conflicting process
lsof -ti:4000 | xargs kill
```
