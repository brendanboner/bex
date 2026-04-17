# OpenClaw — Copilot Instructions

## Commands

```bash
npm install                     # Install all workspace dependencies
npm run build                   # Build all packages (Turborepo)
npm run dev                     # Start all services in watch mode (parallel)
npm run typecheck               # Type-check all packages
npm run lint                    # ESLint across all packages
npm run test                    # Run all tests

# Quick start (first time)
make setup                      # Generates .env with secure secrets
make run                        # docker compose up + migrations + seed

# Run a single test file:
npx vitest run packages/credential-vault/src/crypto.test.ts

# Database
npm run db:migrate              # Deploy Prisma migrations (production)
cd packages/shared && npx prisma migrate dev   # Create a new migration (dev)
npm run db:generate             # Regenerate Prisma client after schema changes
npm run db:seed                 # Seed default data
make db-studio                  # Open Prisma Studio

# Docker Compose profiles
make run                                        # core services only
make run-with-telegram                          # + Telegram bot
docker compose --profile teams up -d           # + Teams bot
docker compose --profile whatsapp up -d        # + WhatsApp bot
```

---

## Architecture

Turborepo monorepo. All packages are under `packages/`, integrations under `integrations/`, the Next.js dashboard under `apps/dashboard/`.

### Package dependency graph

```
shared ← credential-vault
shared ← permission-gateway
shared ← skill-engine ← skill-registry-client
shared ← ssh-executor ← credential-vault
shared ← orchestrator ← credential-vault, skill-engine, permission-gateway, ssh-executor
orchestrator ← scheduler
orchestrator, credential-vault, permission-gateway, skill-engine,
  scheduler, ssh-executor, skill-registry-client ← api-gateway
api-gateway ← integrations/telegram, integrations/teams, integrations/whatsapp
```

### Request lifecycle

1. **Input arrives** via `api-gateway` (REST), `telegram`, `teams`, or `whatsapp` integration.
2. `api-gateway` validates the JWT, creates an `AgentRequest` record, and enqueues it via BullMQ.
3. `scheduler` worker dequeues the job and calls `OrchestratorService.execute()`.
4. **Orchestrator** looks up the agent + loads its skills from the DB.
5. If no skill matches the intent → `permission-gateway` raises an approval request → waits for approval → `skill-engine` discovers/builds a new skill via LLM-driven parsing of knowledge sources.
6. Orchestrator builds LLM tools from the skill definition and calls the LLM via Vercel AI SDK.
7. Tool calls are proxied through `CredentialVaultService.proxyRequest()` — credentials are never exposed.
8. SSH commands are proxied through `SshExecutorService.exec()` — credentials resolved from vault.
9. Result is persisted to `AgentRequest.output`.

### Key services

| Package | Responsibility |
|---|---|
| `@bclaw/shared` | Prisma schema, Zod schemas, shared TypeScript types, `ok()`/`err()` helpers |
| `@bclaw/credential-vault` | AES-256-GCM encryption, outbound HTTP proxy that injects credentials |
| `@bclaw/ssh-executor` | SSH client (ssh2); exec + verify; LLM-callable `createSshTool()` |
| `@bclaw/permission-gateway` | Approval workflows; Telegram/Teams/WhatsApp notification adapters |
| `@bclaw/skill-engine` | Skill discovery (LLM + knowledge parsing), skill builder (URL fetch + parse), test runner |
| `@bclaw/skill-registry-client` | Push/pull skill manifests to/from central registry; checksum verification |
| `@bclaw/orchestrator` | Core execution engine; LLM multi-provider via Vercel AI SDK |
| `@bclaw/scheduler` | BullMQ worker + cron loop for scheduled agent jobs |
| `@bclaw/api-gateway` | Fastify server, JWT auth, all HTTP routes, audit trail |
| `@bclaw/dashboard-api` | Admin REST API (status, users, scheduled jobs, endpoints) |
| `@bclaw/integration-telegram` | grammY bot → api-gateway bridge |
| `@bclaw/integration-teams` | botbuilder Teams bot → api-gateway bridge |
| `@bclaw/integration-whatsapp` | Twilio WhatsApp bot → api-gateway bridge |

### API surface (api-gateway :4000)

```
Agents:       GET/POST /agents,  GET/PUT/DELETE /agents/:id
Skills:       GET/POST /skills,  GET/PUT/DELETE /skills/:id
              POST /skills/build             — build from URLs
              POST /skills/:id/test          — run test suite
              POST /skills/:id/publish       — publish (system user)
              POST /skills/:id/publish-to-registry — push to remote registry
Credentials:  GET/POST /credentials,  DELETE /credentials/:id
Targets:      GET/POST /targets, GET/PUT/DELETE /targets/:id
              POST /targets/:id/verify-ssh   — test SSH connectivity
              POST /targets/:id/exec         — run SSH command (system user)
Requests:     GET/POST /requests, GET /requests/:id
              POST /requests/:id/escalate    — spawn remediation agent
Approvals:    POST /approvals/:id/approve,  POST /approvals/:id/deny
Registry:     GET /registry/skills[?domain=]
              GET /registry/skills/:domain/:version
              POST /registry/publish         — receive/forward manifest
              POST /registry/install/:domain/:version — pull + install skill
Health:       GET /health
```

---

## Key conventions

### Response envelope
All API responses use the shared `ApiResponse<T>` type from `@bclaw/shared`:
```ts
{ ok: true, data: T }           // success
{ ok: false, error: { code, message, details? } }  // error
```
Always use the `ok()` and `err()` helpers from `@bclaw/shared` — never construct these objects manually.

### Error codes
Use constants from `ErrorCodes` in `@bclaw/shared` (e.g. `ErrorCodes.NOT_FOUND`). Use `ErrorCodes.INTERNAL` (not `INTERNAL_ERROR`). Attach a `code` property to thrown errors using `Object.assign(new Error(...), { code })`.

### Schema validation
All external input is validated with Zod schemas defined in `packages/shared/src/schemas/index.ts`. Add new schemas there — not in individual packages.

### Prisma access
Each service instantiates its own `PrismaClient`. Do not create a global singleton across services. All DB schema changes go in `packages/shared/prisma/schema.prisma`, followed by `npm run db:generate`.

### Credential vault — never bypass
All outbound API calls that require credentials **must** go through `CredentialVaultService.proxyRequest()`. SSH sessions must go through `SshExecutorService.exec()`. Never read raw credentials outside these services.

### Skill lifecycle
`DRAFT` → `PENDING_REVIEW` → `PUBLISHED` → `DEPRECATED`
- Build a skill: `POST /skills/build` with `{ domain, intent, sources }`
- Test before publishing: `POST /skills/:id/test`
- Publish: `POST /skills/:id/publish` (system user only)
- Share: `POST /skills/:id/publish-to-registry` → pushes to central SKILL_REGISTRY_URL
- Install remote: `POST /registry/install/:domain/:version`

### Monitoring agent pattern
Monitoring agents return structured `MonitoringResult` JSON:
```ts
{ healthy: boolean, alarms: Alarm[], drift: boolean, driftItems: DriftItem[], summary: string }
```
If `!healthy` → call `POST /requests/:id/escalate` to spawn a remediation agent.
Remediation agents with write permissions require approval via permission-gateway.

### LLM provider abstraction
Use `buildLlmModel(provider, model)` from `@bclaw/orchestrator` to get a Vercel AI SDK `LanguageModel`. For structured output (skill discovery/testing), use `generateObject`. For agent execution, use `generateText` with `maxSteps`.

### Approval channels
`DEFAULT_APPROVAL_CHANNEL` controls which adapter is used: `telegram`, `teams`, or `whatsapp`. The approval callback URL must be publicly accessible (`PERMISSION_GATEWAY_CALLBACK_URL`).

### Imports
Use `@bclaw/<package>` workspace imports. TypeScript project references enforce build order. Always use `.js` extensions in import paths (ESM + `NodeNext`).

### Environment
`make setup` auto-generates all secrets. Required for operation: `CREDENTIAL_VAULT_KEY` (64 hex chars), `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and at least one LLM key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).


## Commands

```bash
npm install                     # Install all workspace dependencies
npm run build                   # Build all packages (Turborepo)
npm run dev                     # Start all services in watch mode (parallel)
npm run typecheck               # Type-check all packages
npm run lint                    # ESLint across all packages
npm run test                    # Run all tests
npm run test:watch              # Run tests in watch mode

# Run a single test file:
npx vitest run packages/credential-vault/src/crypto.test.ts

# Database
npm run db:migrate              # Deploy Prisma migrations (production)
cd packages/shared && npx prisma migrate dev   # Create a new migration (dev)
npm run db:generate             # Regenerate Prisma client after schema changes
npm run db:seed                 # Seed default data
npm run db:studio               # Open Prisma Studio

# Docker Compose (production)
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml --profile telegram up -d --build
```

---

## Architecture

Turborepo monorepo. All packages are under `packages/`, integrations under `integrations/`, the Next.js dashboard under `apps/dashboard/`.

### Package dependency graph

```
shared ← credential-vault
shared ← permission-gateway
shared ← skill-engine
shared ← orchestrator ← credential-vault, skill-engine, permission-gateway
orchestrator ← scheduler
orchestrator, credential-vault, permission-gateway, skill-engine, scheduler ← api-gateway
api-gateway ← integrations/telegram, integrations/teams
```

### Request lifecycle

1. **Input arrives** via `api-gateway` (REST), `telegram`, or `teams` integration.
2. `api-gateway` validates the JWT, creates an `AgentRequest` record, and enqueues it via BullMQ.
3. `scheduler` worker dequeues the job and calls `OrchestratorService.execute()`.
4. **Orchestrator** looks up the agent + loads its skills from the DB.
5. If no skill matches the intent → `permission-gateway` raises an approval request → waits for approval → `skill-engine` discovers a new skill via LLM-driven parsing of knowledge sources.
6. Orchestrator builds LLM tools from the skill definition and calls the LLM via Vercel AI SDK.
7. Tool calls are proxied through `CredentialVaultService.proxyRequest()` — credentials are never exposed to the LLM or calling code.
8. Result is persisted to `AgentRequest.output`.

### Key services

| Package | Responsibility |
|---|---|
| `@bclaw/shared` | Prisma schema, Zod schemas, shared TypeScript types, `ok()`/`err()` helpers |
| `@bclaw/credential-vault` | AES-256-GCM encryption, outbound HTTP proxy that injects credentials |
| `@bclaw/permission-gateway` | Approval workflows; Telegram/Teams notification adapters |
| `@bclaw/skill-engine` | Skill discovery (LLM + knowledge parsing), skill registry CRUD |
| `@bclaw/orchestrator` | Core execution engine; LLM multi-provider via Vercel AI SDK |
| `@bclaw/scheduler` | BullMQ worker + cron loop for scheduled agent jobs |
| `@bclaw/api-gateway` | Fastify server, JWT auth, all HTTP routes, audit trail |
| `@bclaw/integration-telegram` | grammY bot → api-gateway bridge |

---

## Key conventions

### Response envelope
All API responses use the shared `ApiResponse<T>` type from `@bclaw/shared`:
```ts
{ ok: true, data: T }           // success
{ ok: false, error: { code, message, details? } }  // error
```
Always use the `ok()` and `err()` helpers from `@bclaw/shared` — never construct these objects manually.

### Error codes
Use constants from `ErrorCodes` in `@bclaw/shared` (e.g. `ErrorCodes.NOT_FOUND`). Attach a `code` property to thrown errors using `Object.assign(new Error(...), { code })` so the gateway can map them to HTTP status codes.

### Schema validation
All external input is validated with Zod schemas defined in `packages/shared/src/schemas/index.ts`. Add new schemas there — not in individual packages.

### Prisma access
Each service instantiates its own `PrismaClient`. Do not create a global singleton across services. All DB schema changes go in `packages/shared/prisma/schema.prisma`, followed by `npm run db:generate`.

### Credential vault — never bypass
All outbound API calls that require credentials **must** go through `CredentialVaultService.proxyRequest()`. Do not read raw credential values and pass them to `fetch()` directly.

### Skill status flow
`DRAFT` → `PENDING_REVIEW` → `PUBLISHED` → `DEPRECATED`  
Only system users (`User.isSystemUser = true`) can call `/skills/:id/publish`.

### LLM provider abstraction
Use `buildLlmModel(provider, model)` from `@bclaw/orchestrator` to get a Vercel AI SDK `LanguageModel`. For structured output (skill discovery), use `generateObject` from the `ai` package. For agent execution, use `generateText` with `maxSteps`.

### Tool naming
Skill tool names must match `/^[a-z_][a-z0-9_]*$/` (enforced by `SkillToolSchema`). They map directly to LLM function call names.

### Approval channel
`DEFAULT_APPROVAL_CHANNEL` env var controls which adapter is used (`telegram` or `teams`). The approval callback URL must be publicly accessible (set `PERMISSION_GATEWAY_CALLBACK_URL`).

### Imports
Use `@bclaw/<package>` workspace imports. TypeScript project references enforce build order. Always use `.js` extensions in import paths (ESM + `NodeNext`).

### Environment
Copy `.env.example` to `.env`. Required secrets: `CREDENTIAL_VAULT_KEY` (64 hex chars), `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and at least one LLM key.
