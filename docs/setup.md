# bclaw Setup Guide

## Prerequisites

- Node.js ≥ 20
- Docker + Docker Compose
- PostgreSQL 16 (provided by Docker Compose)
- Redis 7 (provided by Docker Compose)

---

## 1. Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

1. Generate a `CREDENTIAL_VAULT_KEY` (64 hex chars):
   ```bash
   openssl rand -hex 32
   ```

2. Generate a `JWT_SECRET`:
   ```bash
   openssl rand -hex 32
   ```

3. Set at least one LLM provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Azure).

4. (Optional) Telegram: create a bot via @BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_APPROVAL_CHAT_ID`.

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Database setup

```bash
# Run migrations
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed default data (system user, example endpoints)
npm run db:seed
```

---

## 4. Development

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
```

---

## 5. Production (Docker Compose)

```bash
# Build and start all services
docker compose -f infra/docker-compose.yml up -d --build

# Start with Telegram bot enabled
docker compose -f infra/docker-compose.yml --profile telegram up -d --build

# View logs
docker compose -f infra/docker-compose.yml logs -f api-gateway

# Run DB migration in container
docker compose -f infra/docker-compose.yml exec api-gateway npx prisma migrate deploy
```

---

## 6. Adding a new skill domain

1. Gather knowledge sources: OpenAPI JSON, PDF docs, or markdown guides.
2. POST to `/skills/discover` with the intent and knowledge sources.
3. Review the generated DRAFT skill in the dashboard.
4. As a system user, POST to `/skills/:id/publish` to make it available.

---

## 7. Registering endpoints

Edit `docs/endpoints.md` and re-run `npm run db:seed`, or use the dashboard → Endpoints section.

---

## 8. Generating a bot JWT (for Telegram/Teams)

```bash
# Using the Node REPL:
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({ sub: 'telegram-bot', isSystemUser: false }, process.env.JWT_SECRET, { expiresIn: '365d' });
console.log(token);
"
```

Set this value as `BCLAW_BOT_API_KEY` in `.env`.
