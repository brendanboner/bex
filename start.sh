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

if [ ! -f .env ]; then
  echo "  ✗ .env not found. Run: bforge init"
  exit 1
fi

set -a && source .env && set +a

# Kill any existing processes on our ports
for PORT_NUM in 4000 4001 5050 3000; do
  for PID in $(lsof -ti ":$PORT_NUM" 2>/dev/null || true); do
    kill "$PID" 2>/dev/null || true
  done
done
sleep 1

echo "  → Starting Skill Registry (port 5050)..."
REGISTRY_TOKEN="${SKILL_REGISTRY_TOKEN:-forge-registry-dev}"
PORT=5050 DATA_DIR="$ROOT/packages/skill-registry/data" REGISTRY_AUTH_TOKEN="$REGISTRY_TOKEN" \
  nohup node packages/skill-registry/dist/server.js > /tmp/forge-registry.log 2>&1 &
REG_PID=$!
echo "    PID $REG_PID — logs: tail -f /tmp/forge-registry.log"

echo "  → Starting API Gateway (port 4000)..."
SKILL_REGISTRY_URL=http://localhost:5050 SKILL_REGISTRY_TOKEN="$REGISTRY_TOKEN" \
  nohup node packages/api-gateway/dist/server.js > /tmp/forge-api.log 2>&1 &
API_PID=$!
echo "    PID $API_PID — logs: tail -f /tmp/forge-api.log"

echo "  → Starting Dashboard API (port 4001)..."
PORT=4001 nohup node packages/dashboard-api/dist/server.js > /tmp/forge-dashboard-api.log 2>&1 &
DAPI_PID=$!
echo "    PID $DAPI_PID — logs: tail -f /tmp/forge-dashboard-api.log"

echo "  → Starting Worker..."
nohup node packages/scheduler/dist/worker.js > /tmp/forge-worker.log 2>&1 &
WORKER_PID=$!
echo "    PID $WORKER_PID — logs: tail -f /tmp/forge-worker.log"

echo "  → Starting Dashboard (port 3000)..."
cd apps/dashboard
nohup npm run dev > /tmp/forge-dashboard.log 2>&1 &
DASH_PID=$!
cd "$ROOT"
echo "    PID $DASH_PID — logs: tail -f /tmp/forge-dashboard.log"

echo ""
echo "  Waiting for services to start..."
sleep 10

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
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  Dashboard     →  http://localhost:3000      │"
echo "  │  API Gateway   →  http://localhost:4000      │"
echo "  │  Admin API     →  http://localhost:4001      │"
echo "  │  Skill Registry→  http://localhost:5050      │"
echo "  ├─────────────────────────────────────────────┤"
echo "  │  Login:  admin@forge.local  /  Forge2024!   │"
echo "  └─────────────────────────────────────────────┘"
echo ""
echo "  PIDs: registry=$REG_PID  api=$API_PID  admin-api=$DAPI_PID  worker=$WORKER_PID  dashboard=$DASH_PID"
echo ""
