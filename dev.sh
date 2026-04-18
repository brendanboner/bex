#!/bin/bash
# Forge — tmux dev session
# Starts all 5 services in the background (writing to logs/), then opens a
# tmux session with each pane tailing its log file live.
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
#   ./dev.sh          — auto-init (first run) + start services + open tmux
#   ./dev.sh attach   — re-attach to a running forge session
#   ./dev.sh stop     — stop all forge services + close session
#   ./dev.sh init     — run init only (no tmux)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="forge"

LOG_API="$ROOT/logs/api-gateway.log"
LOG_REG="$ROOT/logs/skill-registry.log"
LOG_ADM="$ROOT/logs/admin-api.log"
LOG_WRK="$ROOT/logs/worker.log"
LOG_DSH="$ROOT/logs/dashboard.log"

die() { echo "✗ $*" >&2; exit 1; }

# ── stop any process on a specific port ──────────────────────────────────────
stop_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    echo "  stopped :$port"
  fi
}

# ── subcommands ───────────────────────────────────────────────────────────────

case "${1:-}" in
  attach)
    tmux attach-session -t "$SESSION" 2>/dev/null || die "No forge session running. Run ./dev.sh first."
    exit 0
    ;;
  stop)
    echo "Stopping Forge services..."
    stop_port 4000; stop_port 4001; stop_port 5050; stop_port 3000
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "  tmux session '$SESSION' closed" || true
    echo "Done."
    exit 0
    ;;
  init)
    bash "$ROOT/init.sh" --silent
    exit 0
    ;;
esac

# ── pre-flight ────────────────────────────────────────────────────────────────

command -v tmux >/dev/null 2>&1 || die "tmux is not installed (brew install tmux)"

# Auto-init if .env is missing or DB not seeded
if [ ! -f "$ROOT/.env" ]; then
  echo ""
  echo "  First run detected — running forge init..."
  echo ""
  bash "$ROOT/init.sh"
fi

mkdir -p "$ROOT/logs"

# Load env
set -a; source "$ROOT/.env"; set +a
REGISTRY_TOKEN="${SKILL_REGISTRY_TOKEN:-forge-registry-dev}"

# ── stop anything already on our ports ───────────────────────────────────────
stop_port 4000; stop_port 4001; stop_port 5050
sleep 0.5

# ── start services in background → log files ─────────────────────────────────

echo ""
echo "  Starting Forge services..."
echo ""

# Clear old logs
: > "$LOG_API"; : > "$LOG_REG"; : > "$LOG_ADM"; : > "$LOG_WRK"; : > "$LOG_DSH"

SKILL_REGISTRY_URL="http://localhost:5050" SKILL_REGISTRY_TOKEN="$REGISTRY_TOKEN" \
  node "$ROOT/packages/api-gateway/dist/server.js" >> "$LOG_API" 2>&1 &
echo "  ✓ API Gateway       :4000"

PORT=5050 DATA_DIR="$ROOT/packages/skill-registry/data" \
  REGISTRY_AUTH_TOKEN="$REGISTRY_TOKEN" \
  node "$ROOT/packages/skill-registry/dist/server.js" >> "$LOG_REG" 2>&1 &
echo "  ✓ Skill Registry    :5050"

PORT=4001 node "$ROOT/packages/dashboard-api/dist/server.js" >> "$LOG_ADM" 2>&1 &
echo "  ✓ Admin API         :4001"

node "$ROOT/packages/scheduler/dist/worker.js" >> "$LOG_WRK" 2>&1 &
echo "  ✓ Worker            (background)"

(cd "$ROOT/apps/dashboard" && npm run dev >> "$LOG_DSH" 2>&1) &
echo "  ✓ Dashboard         :3000"

sleep 2   # let services write first log lines

# ── tmux session ─────────────────────────────────────────────────────────────

tmux kill-session -t "$SESSION" 2>/dev/null || true

# Helper — print header + tail the log file
tail_cmd() {
  local title="$1" log="$2"
  printf "clear && printf '\\033[1;35m  %s\\033[0m\\n\\n' '%s' && tail -f '%s'" \
    "$title" "$title" "$log"
}

tmux new-session -d -s "$SESSION" -n "forge"

# pane 0 — API Gateway (left column)
tmux send-keys -t "$SESSION" "$(tail_cmd '⚡ API Gateway :4000' "$LOG_API")" Enter

# pane 1 — Skill Registry (right column)
tmux split-window -h -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_cmd '📦 Skill Registry :5050' "$LOG_REG")" Enter

# pane 2 — Admin API (below left)
tmux select-pane -t "$SESSION" -L
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_cmd '🔧 Admin API :4001' "$LOG_ADM")" Enter

# pane 3 — Worker (below right)
tmux select-pane -t "$SESSION" -R
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_cmd '⏱  Worker' "$LOG_WRK")" Enter

# pane 4 — Dashboard (below admin)
tmux select-pane -t "$SESSION" -L
tmux split-window -v -t "$SESSION"
tmux send-keys -t "$SESSION" "$(tail_cmd '🌐 Dashboard :3000' "$LOG_DSH")" Enter

tmux select-layout -t "$SESSION" tiled

# Status bar
tmux set -t "$SESSION" status          on
tmux set -t "$SESSION" status-position bottom
tmux set -t "$SESSION" status-style    "bg=#1a0a3a,fg=#c084fc"
tmux set -t "$SESSION" status-left     "#[fg=#7c3aed,bold] 🔮 FORGE #[default]"
tmux set -t "$SESSION" status-right    "#[fg=#a78bfa] :3000 dashboard  :4000 api  :4001 admin  :5050 registry #[default]"
tmux set -t "$SESSION" status-left-length  20
tmux set -t "$SESSION" status-right-length 65
tmux set -t "$SESSION" pane-active-border-style "fg=#7c3aed"
tmux set -t "$SESSION" pane-border-style        "fg=#3b1f6b"

echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║  🔮 Forge — Dev Session Ready                 ║"
echo "  ║  Dashboard → http://localhost:3000            ║"
echo "  ║  Login     → admin@forge.local / Forge2024!   ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo "  Attaching to tmux... (Ctrl-b d to detach)"
echo ""

tmux attach-session -t "$SESSION"
