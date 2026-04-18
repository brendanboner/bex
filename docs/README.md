# Forge Documentation

**Enterprise Agentic Platform** — build, deploy, and operate autonomous AI agents with secure credential management, federated skill sharing, and approval workflows.

---

## Contents

### Architecture
- [**Overview**](architecture/overview.md) — system design, components, data flow
- [**Data Models**](architecture/data-models.md) — Prisma schema, entity relationships
- [**Tool Router**](architecture/tool-router.md) — smart lazy-loading tool selection
- [**Skill Learning**](architecture/skill-learning.md) — how agents get smarter over time

### Guides
- [**Getting Started**](guides/getting-started.md) — install, configure, first agent
- [**Configuration**](guides/configuration.md) — full `.env` reference
- [**CLI Reference**](guides/cli.md) — all `bforge` commands
- [**Skill Registry**](guides/skill-registry.md) — publishing, pulling, and sharing skills
- [**Credential Management**](guides/credentials.md) — vault, types, assignment
- [**Approval Workflows**](guides/approvals.md) — human-in-the-loop for write operations
- [**Scheduled Jobs**](guides/scheduled-jobs.md) — cron-based monitoring agents

### Examples
- [**ExtremeCloud IQ — Full Setup**](examples/extremecloudiq-setup.md) — end-to-end: skill creation, agent, monitoring
- [**XCO Network Monitoring**](examples/xco-monitoring.md) — XCO fabric agent with SSH + API
- [**Custom Skill from OpenAPI**](examples/custom-skill-openapi.md) — build a skill from any OpenAPI spec
- [**Multi-Agent Orchestration**](examples/multi-agent.md) — coordinator + specialist agents

---

## Quick Reference

```bash
# Clone and start
git clone https://github.com/your-org/forge && cd forge
npm install && npx bforge init

# Daily operations
bforge start        # start all services
bforge status       # health check
bforge logs         # tail all logs
bforge monitor      # tmux log viewer
```

**Service ports:**

| Service | Port | Purpose |
|---|---|---|
| Dashboard | 3000 | Next.js management UI |
| API Gateway | 4000 | Main REST API (JWT) |
| Dashboard API | 4001 | Admin REST API |
| Skill Registry | 5050 | Skill sharing hub |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Job queue (BullMQ) |
