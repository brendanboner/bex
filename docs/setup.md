# Forge Setup Guide

Developer reference for manual setup and advanced configuration.

---

## Prerequisites

- Node.js >= 20
- Docker + Docker Compose
- PostgreSQL 16 (provided by Docker Compose)
- Redis 7 (provided by Docker Compose)

---

## Quick Start (Recommended)

```bash
make install   # npm install + build + link bex CLI
bex init       # interactive wizard: env, migrations, seed, start
```

See [Getting Started](guides/getting-started.md) for the full guided walkthrough.

---

## Manual Setup

### 1. Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

1. `CREDENTIAL_VAULT_KEY` — 64 hex chars:
   ```bash
   openssl rand -hex 32
   ```

2. `JWT_SECRET`:
   ```bash
   openssl rand -hex 32
   ```

3. At least one LLM provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Azure vars).

4. (Optional) Telegram: create a bot via @BotFather, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_APPROVAL_CHAT_ID`.

---

### 2. Install Dependencies

```bash
npm install
```

---

### 3. Database Setup

```bash
# Start infrastructure
docker compose -f infra/docker-compose.yml up -d postgres redis

# Run migrations
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed default data (system user, default agent, XIQ domain knowledge)
npm run db:seed
```

---

### 4. Development

```bash
# Start all services in watch mode
npm run dev

# Run a single test file
npx vitest run packages/credential-vault/src/crypto.test.ts

# Run all tests
npm run test

# Type-check everything
npm run typecheck

# Lint
npm run lint

# Open Prisma Studio
make db-studio
```

---

### 5. Production (Docker Compose)

```bash
# Build and start all services
docker compose -f infra/docker-compose.yml up -d --build

# Start with Telegram bot
docker compose -f infra/docker-compose.yml --profile telegram up -d --build

# Start with Teams bot
docker compose -f infra/docker-compose.yml --profile teams up -d --build

# Start with WhatsApp bot
docker compose -f infra/docker-compose.yml --profile whatsapp up -d --build

# View logs
docker compose -f infra/docker-compose.yml logs -f api-gateway

# Run DB migration in container
docker compose -f infra/docker-compose.yml exec api-gateway npx prisma migrate deploy
```

---

## Adding a New Skill Domain

1. Gather knowledge sources: OpenAPI JSON URL, documentation URLs.
2. `POST /skills/build` with `{ domain, intent, sources }`.
3. The skill engine fetches the spec, generates tools, discovers linked docs, generates playbooks.
4. Review the generated DRAFT skill in the dashboard (Skills page).
5. As a system user, `POST /skills/:id/publish` to make it available.
6. Assign the skill to an agent.

---

## Generating a Bot JWT

For integration bots (Telegram / Teams) that need to call the API:

```bash
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'telegram-bot', isSystemUser: false },
  process.env.JWT_SECRET,
  { expiresIn: '365d' }
);
console.log(token);
"
```

Set the output as `BCLAW_BOT_API_KEY` in `.env`.

---

## Database Operations

```bash
# Create a new migration (dev)
cd packages/shared && npx prisma migrate dev --name my_change

# Deploy migrations (production)
npm run db:migrate

# Regenerate Prisma client after schema changes
npm run db:generate

# Seed default data
npm run db:seed

# Open Prisma Studio
make db-studio
```
