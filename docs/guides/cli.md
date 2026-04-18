# CLI Reference

The `bforge` CLI is the primary management interface for Forge. Install it globally or use `npx bforge`.

```bash
npm install -g @bclaw/cli   # global install
# or
npx bforge <command>         # one-off via npx
```

---

## Commands

### `bforge init`

First-run setup wizard. Run once on a fresh install.

```bash
bforge init
```

Interactively configures:
- LLM provider and API key (validated live)
- Admin account credentials
- Notification channel (Telegram / Teams / WhatsApp / None)
- Generates all secrets and writes `.env`
- Runs Prisma migrations
- Starts all services

---

### `bforge start`

Start all Forge services.

```bash
bforge start
```

Services started (in order):
1. `skill-registry` (port 5050)
2. `api-gateway` (port 4000)
3. `dashboard-api` (port 4001)
4. `scheduler/worker`
5. Configured integration bot (telegram / teams / whatsapp)

Requires a foreground TTY. For background operation, use `bforge start` inside a tmux session, or use the Docker Compose approach (`make up`).

---

### `bforge stop`

Stop all running Forge services.

```bash
bforge stop
```

---

### `bforge status`

Health check all services and show port/PID status.

```bash
bforge status

# Example output:
✔ skill-registry  :5050  healthy
✔ api-gateway     :4000  healthy
✔ dashboard-api   :4001  healthy
✔ worker          —      running (PID 12345)
✔ telegram-bot    —      running (PID 12346)
```

---

### `bforge logs [service]`

Tail log files. With no argument, tails all logs.

```bash
bforge logs              # all services
bforge logs api          # api-gateway only
bforge logs worker       # scheduler/worker
bforge logs telegram     # telegram bot
bforge logs registry     # skill registry
bforge logs dashboard    # dashboard-api
```

---

### `bforge monitor`

Opens a tmux session with split panes showing live logs for all services. Detach at any time with **Ctrl+B, D**.

```bash
bforge monitor
```

Requires `tmux` to be installed.

---

### `bforge build`

Build all TypeScript packages.

```bash
bforge build
```

Equivalent to `npm run build` from the repo root (uses Turborepo).

---

## Environment Variables

The CLI reads from `.env` in the current directory (repo root). All commands inherit the full environment.

If `.env` doesn't exist, run `bforge init` first.

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Service failed to start |
| 3 | Configuration error (missing .env vars) |
