# CLI Reference

The `bex` CLI is the primary management interface for BEX. Install it globally or use `npx bex`.

```bash
npm install -g @bclaw/cli   # global install
# or
npx bex <command>         # one-off via npx
```

---

## Commands

### `bex init`

First-run setup wizard. Run once on a fresh install.

```bash
bex init
```

Interactively configures:
- LLM provider and API key (validated live)
- Admin account credentials
- Notification channel (Telegram / Teams / WhatsApp / None)
- Generates all secrets and writes `.env`
- Runs Prisma migrations
- Starts all services

---

### `bex start`

Start all BEX services.

```bash
bex start
```

Services started (in order):
1. `skill-registry` (port 5050)
2. `api-gateway` (port 4000)
3. `dashboard-api` (port 4001)
4. `scheduler/worker`
5. Configured integration bot (telegram / teams / whatsapp)

Requires a foreground TTY. For background operation, use `bex start` inside a tmux session, or use the Docker Compose approach (`make up`).

---

### `bex stop`

Stop all running BEX services.

```bash
bex stop
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
bex logs dashboard    # dashboard-api
```

---

### `bex monitor`

Opens a tmux session with split panes showing live logs for all services. Detach at any time with **Ctrl+B, D**.

```bash
bex monitor
```

Requires `tmux` to be installed.

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

If `.env` doesn't exist, run `bex init` first.

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Service failed to start |
| 3 | Configuration error (missing .env vars) |
