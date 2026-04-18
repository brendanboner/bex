#!/bin/bash
# Forge — tmux dev session
# Starts all 5 services in the background (writing to /tmp/forge-*.log),
# then opens a tmux session with each pane running tail -f on its log.
#
# Layout (5 panes):
#   ┌─────────────────┬─────────────────┐
#   │  API Gateway    │  Skill Registry │
#   │     :4000       │     :5050       │
#   ├─────────────────┼─────────────────┤
#   │  Admin API      │  Worker         │
#   │     :4001       │                 │
#   ├─────────────────┴─────────────────┤
#   │          Dashboard  :3000          │
#   └───────────────────────────────────┘
#
# Usage:
#   ./dev.sh          — start services + open tmux session
#   ./dev.sh attach   — attach to an existing forge session
#   ./dev.sh stop     — stop all forge services

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="forge"

LOG_API="$ROOT/logs/api-gateway.log"
LOG_REG="$ROOT/logs/skill-registry.log"
LOG_ADM="$ROOT/logs/admin-api.log"
LOG_WRK="$ROOT/logs/worker.log"
LOG_DSH="$ROOT/logs/dashboard.log"

die()  { echo "✗ $*" >&2; exit 1; }

# ── subcommands ───────────────────────────────────────────────────────────────

attach_session() {
  tmux attach-session -t "$SESSION" 2>/dev/null || die "No forge session running. Run ./dev.sh first."
  exit 0
}

stop_services() {
  echo "Stopping Forge services..."
  for PORT in 4000 4001 5050 3000; do
    PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
    for PID in $PIDS; do
      kill "$PID" 2>/dev/null && echo "  stopped :$PORT (PID $PID)" || true
    done
  done
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "  tmux session '$SESSION' closed" || true
  echo "Done."
  exit 0
}

case "${1:-}" in
  attach) attach_session ;;
  stop)   stop_services  ;;
esac

# ── pre-flight ────────────────────────────────────────────────────────────────

command -v tmux >/dev/null 2>&1 || die "tmux is not installed (brew install tmux)"
[ -f "$ROOT/.env" ] || die ".env not found — run: bforge init"

mkdir -p "$ROOT/logs"

# Load env
set -a; source "$ROOT/.env"; set +a
REGISTRY_TOKEN="${SKILL_REGISTRY_TOKEN:-forge-registry-dev}"

# Stop any processes already on our ports
for PORT in 4000 4001 5050; do
  PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
  for PID in $PIDS; do kill "$PID" 2>/dev/null || true; done
done
sleep 1

# ── start services in background → log files ─────────────────────────────────

echo "  Starting services..."

SKILL_REGISTRY_URL=http://localhost:5050 SKILL_REGISTRY_TOKEN="$REGISTRY_TOKEN" \
  node "$ROOT/packages/api-gateway/dist/server.js" >> "$LOG_API" 2>&1 &
echo "  ✓ API Gateway       → $LOG_API"

PORT=5050 DATA_DIR="$ROOT/packages/skill-registry/data" \
  REGISTRY_AUTH_TOKEN="$REGISTRY_TOKEN" \
  node "$ROOT/packages/skill-registry/dist/server.js" >> "$LOG_REG" 2>&1 &
echo "  ✓ Skill Registry    → $LOG_REG"

PORT=4001 node "$ROOT/packages/dashboard-api/dist/server.js" >> "$LOG_ADM" 2>&1 &
echo "  ✓ Admin API         → $LOG_ADM"

node "$ROOT/packages/scheduler/dist/worker.js" >> "$LOG_WRK" 2>&1 &
echo "  ✓ Worker            → $LOG_WRK"

(cd "$ROOT/apps/dashboard" && npm run dev >> "$LOG_DSH" 2>&1) &
echo "  ✓ Dashboard         → $LOG_DSH"

sleep 2  # give processes a moment to write their first lines

# ── tmux session ─────────────────────────────────────────────────────────────

tmux kill-session -t "$SESSION" 2>/dev/null || true

# Helper: clear pane, print title, then tail -f the log
tail_pane() {
  local title="$1" log="$2"
  printf "clear && printf '\\033[1;35m  %s\\033[0m\\n' '%s' && printf '\\033[2m  %s\\033[0m\\n\\n' '%s' && tail -f '%s'" \
    "$title" "$title" "$log" "$log" "$log"
}

tmux new-session -d -s "$SESSION" -n "forge"

# pane 0 — API Gateway
tmux send-keys -t "$SESSION" "$(tail_pane '⚡ API Gateway :4000' "$LOG_API")" Enter

# pane 1 — Skill Registry (right)
tmux split-window -h -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_pane '📦 Skill Registry :5050' "$LOG_REG")" Enter

# pane 2 — Admin API (below left)
tmux select-pane -t "$SESSION" -L
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_pane '🔧 Admin API :4001' "$LOG_ADM")" Enter

# pane 3 — Worker (below right)
tmux select-pane -t "$SESSION" -R
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_pane '⏱  Worker' "$LOG_WRK")" Enter

# pane 4 — Dashboard (below admin-api)
tmux select-pane -t "$SESSION" -L
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_pane '🌐 Dashboard :3000' "$LOG_DSH")" Enter

tmux select-layout -t "$SESSION" tiled

# Status bar
tmux set -t "$SESSION" status on
tmux set -t "$SESSION" status-position bottom
tmux set -t "$SESSION" status-style  "bg=#1a0a3a,fg=#c084fc"
tmux set -t "$SESSION" status-left   "#[fg=#7c3aed,bold] 🔮 FORGE #[default]"
tmux set -t "$SESSION" status-right  "#[fg=#a78bfa] :3000 dashboard  :4000 api  :4001 admin  :5050 registry #[default] "
tmux set -t "$SESSION" status-left-length  20
tmux set -t "$SESSION" status-right-length 65
tmux set -t "$SESSION" pane-active-border-style "fg=#7c3aed"
tmux set -t "$SESSION" pane-border-style        "fg=#3b1f6b"

echo ""
echo "  ╔════════════════════════════════════════════╗"
echo "  ║    Forge — session 'forge' ready           ║"
echo "  ╚════════════════════════════════════════════╝"
echo "  Attaching... (Ctrl-b d to detach)"
echo ""

tmux attach-session -t "$SESSION"


set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="forge"

# ── helpers ──────────────────────────────────────────────────────────────────

die() { echo "✗ $*" >&2; exit 1; }

check_deps() {
  command -v tmux >/dev/null 2>&1 || die "tmux is not installed (brew install tmux)"
  [ -f "$ROOT/.env" ]            || die ".env not found — run: bforge init"
}

kill_session() {
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "Session '$SESSION' killed." || echo "No session named '$SESSION'."
  exit 0
}

attach_session() {
  tmux attach-session -t "$SESSION" 2>/dev/null || die "No forge session running. Start one with: ./dev.sh"
}

# ── service start commands ────────────────────────────────────────────────────
# Each pane runs: clear, print a header, start the service.
# Services source .env themselves via the inline env() call.

pane_cmd() {
  local title="$1"
  local cmd="$2"
  # Print a coloured header then exec the service command
  printf "clear && printf '\\033[1;35m  %s\\033[0m\\n\\n' '%s' && source %s/.env 2>/dev/null; %s" \
    "$title" "$title" "$ROOT" "$cmd"
}

# ── main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  kill)   kill_session ;;
  attach) attach_session ;;
esac

check_deps

# Kill any stale session with the same name
tmux kill-session -t "$SESSION" 2>/dev/null || true

# ── create session + panes ───────────────────────────────────────────────────

# ── create session + panes ───────────────────────────────────────────────────
# Each split targets the session; tmux applies to the current active pane.
# After each split, the new pane becomes active automatically.

# Window 0, pane 0 — API Gateway
tmux new-session -d -s "$SESSION" -n "forge"
tmux send-keys -t "$SESSION" \
  "$(pane_cmd '⚡ API Gateway :4000' \
    "SKILL_REGISTRY_URL=http://localhost:5050 SKILL_REGISTRY_TOKEN=\${SKILL_REGISTRY_TOKEN:-forge-registry-dev} node $ROOT/packages/api-gateway/dist/server.js")" Enter

# Pane 1 — Skill Registry (right column)
tmux split-window -h -t "$SESSION"
tmux send-keys -t "$SESSION" \
  "$(pane_cmd '📦 Skill Registry :5050' \
    "PORT=5050 DATA_DIR=$ROOT/packages/skill-registry/data REGISTRY_AUTH_TOKEN=\${SKILL_REGISTRY_TOKEN:-forge-registry-dev} node $ROOT/packages/skill-registry/dist/server.js")" Enter

# Pane 2 — Admin API (below right column — select pane 0 first)
tmux select-pane -t "$SESSION" -L          # move to left pane
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" \
  "$(pane_cmd '🔧 Admin API :4001' \
    "PORT=4001 node $ROOT/packages/dashboard-api/dist/server.js")" Enter

# Pane 3 — Worker (below right column)
tmux select-pane -t "$SESSION" -R          # move to right pane
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" \
  "$(pane_cmd '⏱  Worker' \
    "node $ROOT/packages/scheduler/dist/worker.js")" Enter

# Pane 4 — Dashboard (full-width at bottom, split below admin-api pane)
tmux select-pane -t "$SESSION" -L          # move to left column bottom (admin api)
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" \
  "$(pane_cmd '🌐 Dashboard :3000' \
    "cd $ROOT/apps/dashboard && npm run dev")" Enter

# Spread panes evenly
tmux select-layout -t "$SESSION" tiled

# Status bar — service URLs in the bottom
tmux set -t "$SESSION" status on
tmux set -t "$SESSION" status-position bottom
tmux set -t "$SESSION" status-style "bg=#1a0a3a,fg=#c084fc"
tmux set -t "$SESSION" status-left  "#[fg=#7c3aed,bold] 🔮 FORGE #[default]"
tmux set -t "$SESSION" status-right "#[fg=#a78bfa] dashboard:3000  api:4000  admin:4001  registry:5050 #[default] "
tmux set -t "$SESSION" status-left-length 20
tmux set -t "$SESSION" status-right-length 60

# Highlight active pane
tmux set -t "$SESSION" pane-active-border-style "fg=#7c3aed"
tmux set -t "$SESSION" pane-border-style "fg=#3b1f6b"

echo ""
echo "  ╔════════════════════════════════════════════╗"
echo "  ║    Forge — Dev Session Started             ║"
echo "  ╚════════════════════════════════════════════╝"
echo ""
echo "  Session name: $SESSION"
echo "  Attaching...  (Ctrl-b d to detach)"
echo ""

sleep 0.5
tmux attach-session -t "$SESSION"
