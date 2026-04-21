# CLI Reference

The `bex` CLI is the primary management interface for Forge. It is linked globally by `make install`.

```bash
make install         # build all packages and link bex globally
# or manually:
npm run build && npm link
```

---

## Commands

### `bex init`

First-run setup wizard. Run once on a fresh install (or re-run to reconfigure).

```bash
bex init
```

Interactively configures:
- LLM provider and API key (validated live)
- Interface channel (Telegram / Teams / WhatsApp / dashboard only)
- Optional network integrations (XIQ, XCO)
- Admin account credentials
- Generates all secrets and writes `.env`
- Starts Docker infrastructure, runs Prisma migrations, seeds data
- Starts all services via pm2

---

### `bex start`

Start all Forge services.

```bash
bex start
```

Services started (in order):
1. `skill-registry` (port 5050)
2. `api-gateway` (port 4000)
3. `dashboard-api` (port 4001)
4. `dashboard` (port 3000)
5. `scheduler/worker`
6. Configured integration bot (telegram / teams / whatsapp)

---

### `bex stop`

Stop all running Forge services.

```bash
bex stop
```

---

### `bex restart`

Stop and restart all services.

```bash
bex restart
```

---

### `bex status`

Health check all services and show port/PID status.

```bash
bex status

# Example output:
✔ skill-registry  :5050  healthy
✔ api-gateway     :4000  healthy
✔ dashboard-api   :4001  healthy
✔ dashboard       :3000  running
✔ worker          —      running (PID 12345)
✔ telegram-bot    —      running (PID 12346)
```

---

### `bex logs [service]`

Tail log files. With no argument, tails all logs.

```bash
bex logs              # all services
bex logs api          # api-gateway only
bex logs worker       # scheduler/worker
bex logs telegram     # telegram bot
bex logs registry     # skill registry
bex logs dashboard    # dashboard and dashboard-api
```

---

### `bex build`

Build all TypeScript packages.

```bash
bex build
```

Equivalent to `npm run build` from the repo root (uses Turborepo).

---

## Environment Variables

The CLI reads from `.env` in the current directory (repo root). All commands inherit the full environment.

If `.env` does not exist, run `bex init` first.

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Service failed to start |
| 3 | Configuration error (missing .env vars) |
