#!/bin/bash
# Forge — local dev startup script
# Starts all services without Docker. Requires .env, postgres and redis already running.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo "  ╔════════════════════════════════════════════╗"
echo "  ║    Forge — Enterprise Agentic Platform     ║"
echo "  ╚════════════════════════════════════════════╝"
echo ""

# Auto-init on first run
if [ ! -f .env ]; then
  echo "  First run — running forge init..."
  bash "$ROOT/init.sh"
fi

set -a && source .env && set +a

# Kill any existing processes on our ports
stop_port() {
  local pids
  pids=$(lsof -ti ":$1" 2>/dev/null || true)
  [ -n "$pids" ] && echo "$pids" | xargs kill 2>/dev/null || true
}
stop_port 4000; stop_port 4001; stop_port 5050; stop_port 3000
sleep 1

REGISTRY_TOKEN="${SKILL_REGISTRY_TOKEN:-forge-registry-dev}"
mkdir -p "$ROOT/logs"
: > "$ROOT/logs/skill-registry.log"; : > "$ROOT/logs/api-gateway.log"
: > "$ROOT/logs/admin-api.log"; : > "$ROOT/logs/worker.log"; : > "$ROOT/logs/dashboard.log"

echo "  → Starting Skill Registry (port 5050)..."
nohup bash -c "PORT=5050 DATA_DIR='$ROOT/packages/skill-registry/data' REGISTRY_AUTH_TOKEN='$REGISTRY_TOKEN' node '$ROOT/packages/skill-registry/dist/server.js'" >> "$ROOT/logs/skill-registry.log" 2>&1 &
REG_PID=$!; disown $REG_PID
echo "    PID $REG_PID"

echo "  → Starting API Gateway (port 4000)..."
nohup bash -c "SKILL_REGISTRY_URL='http://localhost:5050' SKILL_REGISTRY_TOKEN='$REGISTRY_TOKEN' DATABASE_URL='$DATABASE_URL' REDIS_URL='$REDIS_URL' JWT_SECRET='$JWT_SECRET' CREDENTIAL_VAULT_KEY='$CREDENTIAL_VAULT_KEY' CORS_ORIGIN='${CORS_ORIGIN:-http://localhost:3000}' OPENAI_API_KEY='${OPENAI_API_KEY:-}' node '$ROOT/packages/api-gateway/dist/server.js'" >> "$ROOT/logs/api-gateway.log" 2>&1 &
API_PID=$!; disown $API_PID
echo "    PID $API_PID"

echo "  → Starting Admin API (port 4001)..."
nohup bash -c "PORT=4001 DATABASE_URL='$DATABASE_URL' REDIS_URL='$REDIS_URL' JWT_SECRET='$JWT_SECRET' CORS_ORIGIN='${CORS_ORIGIN:-http://localhost:3000}' node '$ROOT/packages/dashboard-api/dist/server.js'" >> "$ROOT/logs/admin-api.log" 2>&1 &
DAPI_PID=$!; disown $DAPI_PID
echo "    PID $DAPI_PID"

echo "  → Starting Worker..."
nohup bash -c "DATABASE_URL='$DATABASE_URL' REDIS_URL='$REDIS_URL' CREDENTIAL_VAULT_KEY='$CREDENTIAL_VAULT_KEY' OPENAI_API_KEY='${OPENAI_API_KEY:-}' node '$ROOT/packages/scheduler/dist/worker.js'" >> "$ROOT/logs/worker.log" 2>&1 &
WORKER_PID=$!; disown $WORKER_PID
echo "    PID $WORKER_PID"

echo "  → Starting Dashboard (port 3000)..."
nohup bash -c "cd '$ROOT/apps/dashboard' && exec node_modules/.bin/next dev -p 3000" >> "$ROOT/logs/dashboard.log" 2>&1 &
DASH_PID=$!; disown $DASH_PID
echo "    PID $DASH_PID"

echo ""
echo "  Waiting for services to start..."
sleep 15

# Health checks
for URL in "http://localhost:5050/health" "http://localhost:4000/health" "http://localhost:4001/health" "http://localhost:3000"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ $URL"
  else
    echo "  ⚠ $URL (HTTP $STATUS — may still be starting)"
  fi
done

echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  Dashboard     →  http://localhost:3000           │"
echo "  │  API Gateway   →  http://localhost:4000           │"
echo "  │  Admin API     →  http://localhost:4001           │"
echo "  │  Skill Registry→  http://localhost:5050           │"
echo "  ├──────────────────────────────────────────────────┤"
echo "  │  Login:  admin@forge.local  /  Forge2024!        │"
echo "  ├──────────────────────────────────────────────────┤"
echo "  │  Logs:   tail -f $ROOT/logs/<service>.log        │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
echo "  PIDs: registry=$REG_PID  api=$API_PID  admin=$DAPI_PID  worker=$WORKER_PID  dashboard=$DASH_PID"
echo ""
