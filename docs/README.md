# Forge Documentation

**Enterprise Agentic Platform** — build, deploy, and operate autonomous AI agents with secure credential management, domain intelligence, federated skill sharing, and approval workflows.

---

## Contents

### Architecture
- [**Overview**](architecture/overview.md) — system design, components, data flow
- [**Data Models**](architecture/data-models.md) — Prisma schema, entity relationships
- [**Domain Intelligence**](architecture/domain-intelligence.md) — doc index, entity graphs, analysis playbooks
- [**Skill Learning**](architecture/skill-learning.md) — how agents accumulate runtime knowledge

### Guides
- [**Getting Started**](guides/getting-started.md) — install, configure, first agent
- [**CLI Reference**](guides/cli.md) — all `bex` commands
- [**Personas**](guides/personas.md) — goal-based agent generation
- [**Coordinator**](guides/coordinator.md) — multi-agent orchestration
- [**Setup (Dev)**](setup.md) — developer setup reference

### Examples
- [**ExtremeCloud IQ — Full Setup**](examples/extremecloudiq-setup.md) — end-to-end: persona, skill, monitoring

---

## Quick Reference

```bash
# Clone and start
git clone https://github.com/your-org/bex && cd bex
make install && bex init

# Daily operations
bex start        # start all services
bex status       # health check
bex logs         # tail all logs
bex restart      # restart all services
```

**Service ports:**

| Service | Port | Purpose |
|---|---|---|
| Dashboard | 3000 | Next.js 14 management UI |
| API Gateway | 4000 | Main REST API (JWT) |
| Dashboard API | 4001 | Admin REST API |
| Skill Registry | 5050 | Skill sharing hub |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Job queue (BullMQ) |

**Key API paths:**

| Area | Endpoints |
|---|---|
| Agents | `GET/POST /agents`, `GET/PUT/DELETE /agents/:id` |
| Skills | `POST /skills/build`, `POST /skills/:id/publish`, `POST /skills/:id/test` |
| Personas | `POST /personas/generate`, `POST /personas/:id/spawn` |
| Coordinator | `POST /coordinator/chat`, `GET /coordinator/sessions/:id` |
| Domain Intel | `GET/PUT /domains/:domain/knowledge`, `PATCH .../playbooks` |
| Approvals | `POST /approvals/:id/approve`, `POST /approvals/:id/deny` |
