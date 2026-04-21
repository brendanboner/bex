# Getting Started

This guide takes you from a fresh clone to a working Forge instance with an agent responding in the dashboard (or Telegram) in under 15 minutes.

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
make install
```

`make install` runs `npm install`, builds all packages, and links the `bex` CLI globally.

Alternatively:

```bash
npm install
npm run build
npm link
```

---

## Step 2 — Run the Setup Wizard

```bash
bex init
```

The wizard asks for:

1. **LLM Provider** — OpenAI / Anthropic / Azure OpenAI
2. **API key** — validated live against the provider
3. **LLM model** — e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`
4. **Interface channel** — Telegram / Teams / WhatsApp / Dashboard only
5. **Optional integrations** — ExtremeCloud IQ credentials, XCO setup
6. **Admin account** — username and password for the dashboard

At the end, `bex init` will:
- Write a `.env` file with all generated secrets
- Start Docker infrastructure (Postgres + Redis)
- Run Prisma migrations
- Seed the database (system user, default agent, XIQ domain knowledge)
- Start all services via pm2

---

## Step 3 — Start Services

If `bex init` did not start services automatically (e.g. on subsequent runs):

```bash
bex start
```

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
✔ dashboard       :3000  running
✔ telegram-bot    —      running   (if configured)
```

---

## Step 5 — Open the Dashboard

Navigate to **http://localhost:3000** and log in with the admin credentials you set in Step 2.

Dashboard sections:
- **Nexus** (`/chat`) — multi-agent chat interface
- **Agents** — create and configure agents, assign skills and credentials, set charter
- **Skills** — browse, build, and manage skill libraries; view learned notes
- **Personas** (`/personas`) — generate personas from goals, spawn agents
- **Domain Intel** (`/domains`) — documentation index, entity graphs, playbooks per domain
- **Vault** (`/credentials`) — encrypted credential storage
- **Activity** (`/requests`) — request history with input/output
- **Scheduled** — cron-based monitoring agents
- **Configuration** (`/setup`) — LLM config, notification channels

---

## Step 6 — Send Your First Message

Use the **Nexus** chat at `http://localhost:3000/chat`, or if you configured Telegram, send a message to your bot:

```
What can you help me with?
```

The default "Forge Assistant" agent handles general requests using all published skills.

---

## Step 7 — Create a Persona or Agent

The fastest way to create a purpose-built agent is via Personas.

### Via Dashboard

1. Go to **Personas → Generate Persona**
2. Enter your goal:
   ```
   Monitor ExtremeCloud IQ for disconnected APs and new client devices.
   Alert via Telegram. Run every hour.
   ```
3. Review the generated system prompt, tone, and suggested schedule
4. Click **Spawn Agent** — this creates an `ACTIVE` agent linked to the persona

### Via API

```bash
# Generate persona
curl -X POST http://localhost:4000/personas/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal": "Monitor ExtremeCloud IQ for disconnected APs"}'

# Spawn agent from persona
curl -X POST http://localhost:4000/personas/$PERSONA_ID/spawn \
  -H "Authorization: Bearer $TOKEN"
```

See the [Personas guide](personas.md) for full details.

---

## Step 8 — Build a Skill

Add capabilities for a new API domain:

### Via Dashboard Chat

```
Build a skill from the OpenAPI spec at https://api.extremecloudiq.com/openapi
```

The skill engine will:
1. Fetch and parse the OpenAPI spec
2. Group operations by tag into skill domains
3. Generate tool definitions for each operation
4. Run `discoverLinkedDocs()` — scrapes same-host documentation links, categorises them
5. Run `generatePlaybooks()` — generates 1–3 analysis playbooks for complex queries
6. Store everything in `DomainKnowledge`
7. Run automated tests
8. Ask for your approval before publishing

### Via API

```bash
curl -X POST http://localhost:4000/skills/build \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "extremecloudiq",
    "intent": "Manage ExtremeCloud IQ devices and clients",
    "sources": ["https://api.extremecloudiq.com/openapi"]
  }'
```

After building, publish (system user only):

```bash
curl -X POST http://localhost:4000/skills/$SKILL_ID/publish \
  -H "Authorization: Bearer $SYSTEM_TOKEN"
```

---

## Step 9 — Schedule Monitoring

For an hourly monitoring agent with smart alerting:

1. Go to **Scheduled → New Job**
2. Set:
   - **Agent**: your monitoring agent
   - **Schedule**: `0 * * * *` (hourly)
   - **Message**: `Check for disconnected APs and critical alarms. Summarise network health.`
3. Save

When the agent detects no changes, it outputs `[NO_CHANGE]` at the start of its response. The scheduler skips writing to agent memory and skips the Telegram notification — preventing alert fatigue.

---

## Common First Tasks

| What you want to do | How |
|---|---|
| Generate an agent from a goal | Personas → Generate Persona → Spawn Agent |
| Store an API key | Dashboard → Vault → New Credential |
| Assign credentials to agent | Dashboard → Agent → Edit → Credentials tab |
| Build a skill from API docs | Skills → Build from URL |
| See domain intelligence | Domain Intel → select domain |
| Schedule hourly monitoring | Scheduled → New Job → cron `0 * * * *` |
| Route query to best-fit agent | `POST /coordinator/chat` |
| View request history | Activity → select request |

---

## Troubleshooting

**Services won't start:**
```bash
bex status          # identify which service is unhealthy
bex logs api        # tail api-gateway logs
bex logs worker     # tail worker logs
```

**Telegram bot not responding:**
```bash
bex logs telegram
# Ensure TELEGRAM_BOT_TOKEN and TELEGRAM_DEFAULT_AGENT_ID are set in .env
```

**LLM errors:**
- Verify `OPENAI_API_KEY` is set and valid
- Check model name (e.g. `gpt-4o` not `gpt4o`)
- For Azure: ensure `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` are set

**Database errors:**
```bash
# Re-run migrations
cd packages/shared && npx prisma migrate deploy

# Reset database (destroys all data)
cd packages/shared && npx prisma migrate reset
```

**Skill build fails:**
- Verify the OpenAPI URL is publicly accessible
- Check `bex logs api` for the full error
- Use `POST /skills/:id/generate-playbooks` to regenerate domain intelligence retroactively

**Domain intelligence not injecting:**
- Check `GET /domains/:domain/knowledge` — entity graph and playbooks should be non-empty
- If empty after a skill build, use `POST /skills/:id/generate-playbooks` to trigger retroactively
