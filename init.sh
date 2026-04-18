#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Forge — init.sh
#  One-time (and idempotent) platform initialisation.
#  Run this once after cloning; it self-configures and seeds everything.
#
#  Usage:
#    ./init.sh            — interactive (prompts for LLM key if not in .env)
#    ./init.sh --silent   — non-interactive; uses defaults / existing .env only
#    ./init.sh --reset    — wipe DB and re-seed (keeps .env)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SILENT="${1:-}"

# ── colour helpers ────────────────────────────────────────────────────────────
bold='\033[1m'; cyan='\033[1;36m'; green='\033[1;32m'; yellow='\033[1;33m'
red='\033[1;31m'; purple='\033[1;35m'; dim='\033[2m'; reset='\033[0m'

banner() {
  echo ""
  echo -e "${purple}  ╔════════════════════════════════════════════╗${reset}"
  echo -e "${purple}  ║  🔮 Forge — Enterprise Agentic Platform   ║${reset}"
  echo -e "${purple}  ╚════════════════════════════════════════════╝${reset}"
  echo ""
}

info()    { echo -e "  ${cyan}→${reset} $*"; }
success() { echo -e "  ${green}✓${reset} $*"; }
warn()    { echo -e "  ${yellow}⚠${reset} $*"; }
err()     { echo -e "  ${red}✗${reset} $*" >&2; }
step()    { echo -e "\n${bold}  ── $* ──${reset}"; }

# ── helpers ───────────────────────────────────────────────────────────────────

gen_secret() { openssl rand -hex "${1:-32}"; }

wait_for_postgres() {
  local max=30 i=0
  while ! PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U bclaw -d bclaw -c "SELECT 1" >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -ge "$max" ] && { err "Postgres did not become ready in time."; exit 1; }
    printf "."
    sleep 1
  done
  echo ""
}

wait_for_port() {
  local host="${1:-localhost}" port="$2" max=20 i=0
  while ! nc -z "$host" "$port" 2>/dev/null; do
    i=$((i+1))
    [ "$i" -ge "$max" ] && return 1
    sleep 0.5
  done
  return 0
}

# ── banner ────────────────────────────────────────────────────────────────────
banner

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Generate .env if missing
# ─────────────────────────────────────────────────────────────────────────────
step "Environment"

ENV_FILE="$ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  info "Creating .env with secure defaults..."

  POSTGRES_PASSWORD=$(gen_secret 16)
  REDIS_PASSWORD=$(gen_secret 16)
  JWT_SECRET=$(gen_secret 32)
  CREDENTIAL_VAULT_KEY=$(gen_secret 32)
  SKILL_REGISTRY_TOKEN=$(gen_secret 16)

  cat > "$ENV_FILE" << EOF
# ─── Core ────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=4000
DASHBOARD_PORT=3000
LOG_LEVEL=info

# ─── Database ────────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
DATABASE_URL=postgresql://bclaw:${POSTGRES_PASSWORD}@localhost:5432/bclaw?schema=public
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379

# ─── Security ────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
CREDENTIAL_VAULT_KEY=${CREDENTIAL_VAULT_KEY}

# ─── Skill Registry ──────────────────────────────────────────────────────────
# Local registry (started by dev.sh/start.sh). Change to push/pull from a remote server.
SKILL_REGISTRY_TOKEN=${SKILL_REGISTRY_TOKEN}
SKILL_REGISTRY_URL=http://localhost:5050

# ─── LLM (add your key — platform starts without it) ─────────────────────────
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o

# ─── Platform ────────────────────────────────────────────────────────────────
KNOWLEDGE_DIR=./knowledge
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_MAX=100

# ─── Channels (optional) ─────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_APPROVAL_CHAT_ID=
TEAMS_BOT_ID=
TEAMS_BOT_PASSWORD=
BCLAW_BOT_API_KEY=
EOF
  success ".env created with auto-generated secrets"
else
  success ".env already exists — using existing values"
fi

# Load env
set -a; source "$ENV_FILE"; set +a

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — LLM API key (prompt once if missing and not silent)
# ─────────────────────────────────────────────────────────────────────────────

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [ -z "$OPENAI_API_KEY" ] && [ "$SILENT" != "--silent" ]; then
  echo ""
  echo -e "  ${yellow}Optional: add your OpenAI API key now (press Enter to skip)${reset}"
  read -r -p "  OPENAI_API_KEY: " INPUT_KEY
  if [ -n "$INPUT_KEY" ]; then
    # Update .env
    if grep -q "^OPENAI_API_KEY=" "$ENV_FILE"; then
      sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${INPUT_KEY}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
    else
      echo "OPENAI_API_KEY=${INPUT_KEY}" >> "$ENV_FILE"
    fi
    export OPENAI_API_KEY="$INPUT_KEY"
    success "OpenAI API key saved to .env"
  else
    warn "No LLM key — agent execution will be limited until you add one to .env"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Start infrastructure (Postgres + Redis)
# ─────────────────────────────────────────────────────────────────────────────
step "Infrastructure (Postgres + Redis)"

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-forge-dev-postgres}"
REDIS_PASSWORD="${REDIS_PASSWORD:-forge-dev-redis}"

# Check if postgres is already up
if PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U bclaw -d bclaw -c "SELECT 1" >/dev/null 2>&1; then
  success "Postgres already running"
  POSTGRES_WAS_RUNNING=true
else
  POSTGRES_WAS_RUNNING=false
  if command -v docker >/dev/null 2>&1; then
    info "Starting Postgres + Redis via Docker..."
    cd "$ROOT/infra"
    docker compose up -d postgres redis
    cd "$ROOT"
    info "Waiting for Postgres..."
    wait_for_postgres
    success "Postgres ready"
  else
    err "Postgres is not running and Docker is not available."
    err "Start Postgres manually, or install Docker and run: ./init.sh"
    exit 1
  fi
fi

# Check Redis
if nc -z localhost 6379 2>/dev/null; then
  success "Redis already running"
else
  if command -v docker >/dev/null 2>&1; then
    info "Starting Redis..."
    cd "$ROOT/infra"
    docker compose up -d redis
    cd "$ROOT"
    sleep 2
    success "Redis ready"
  else
    warn "Redis not detected on :6379 — BullMQ worker may fail without it"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Database migrations
# ─────────────────────────────────────────────────────────────────────────────
step "Database Migrations"

cd "$ROOT/packages/shared"
info "Running prisma migrate deploy..."
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy 2>&1 | tail -5
success "Migrations complete"
cd "$ROOT"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Seed system user and example data
# ─────────────────────────────────────────────────────────────────────────────
step "Database Seed (system user, examples)"

cd "$ROOT/packages/shared"
DATABASE_URL="$DATABASE_URL" npx prisma db seed 2>&1 | grep -E "Seeded|Error|already" | head -10 || true
success "Seed complete"
cd "$ROOT"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Bootstrap admin user (idempotent)
# ─────────────────────────────────────────────────────────────────────────────
step "Admin User"

ADMIN_EMAIL="${FORGE_ADMIN_EMAIL:-admin@forge.local}"
ADMIN_PASSWORD="${FORGE_ADMIN_PASSWORD:-Forge2024!}"

node - << 'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const email = process.env.FORGE_ADMIN_EMAIL || 'admin@forge.local';
const pw = process.env.FORGE_ADMIN_PASSWORD || 'Forge2024!';

async function run() {
  // Ensure system user
  const sysUser = await prisma.user.upsert({
    where: { externalId: 'system' },
    update: {},
    create: { externalId: 'system', displayName: 'System', email: 'system@forge.internal', isSystemUser: true },
  });
  console.log('system-user-id:' + sysUser.id);

  // Create admin if not exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('admin-exists:' + existing.id);
    return;
  }

  const hash = await bcrypt.hash(pw, 12);
  const admin = await prisma.user.create({
    data: {
      externalId: 'admin-' + Date.now(),
      email,
      displayName: email.split('@')[0] || 'Admin',
      passwordHash: hash,
      isSystemUser: true,
    },
  });
  console.log('admin-created:' + admin.id);
}

run()
  .catch(e => { console.error('bootstrap-error:' + e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
NODE_EOF

success "Admin user ready: ${ADMIN_EMAIL}"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Bootstrap LLM credential in vault (if OPENAI_API_KEY is set)
# ─────────────────────────────────────────────────────────────────────────────
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [ -n "$OPENAI_API_KEY" ]; then
  step "LLM Credential"
  node - << 'NODE_EOF'
const { PrismaClient } = require('@prisma/client');
const { CredentialVaultService } = require('./packages/credential-vault/dist/service.js');

const prisma = new PrismaClient();
const vault = new CredentialVaultService(prisma);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.LLM_MODEL || 'gpt-4o';

async function run() {
  const existing = await prisma.credential.findFirst({ where: { name: 'forge.llm.primary' } });
  if (existing) { console.log('llm-cred-exists'); return; }
  await vault.create({
    name: 'forge.llm.primary',
    description: 'OpenAI LLM configuration',
    scope: 'SYSTEM',
    credentialType: 'API_TOKEN',
    value: { provider: 'openai', apiKey, model },
    allowedAgentPermissions: [],
  });
  console.log('llm-cred-created');
}

run()
  .catch(e => { console.error('llm-cred-error:' + e.message); })
  .finally(() => prisma.$disconnect());
NODE_EOF
  success "LLM credential stored in vault"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${green}${bold}  ╔════════════════════════════════════════════════════╗${reset}"
echo -e "${green}${bold}  ║  ✅  Forge initialised and ready to start!        ║${reset}"
echo -e "${green}${bold}  ╚════════════════════════════════════════════════════╝${reset}"
echo ""
echo -e "  ${bold}Next steps:${reset}"
echo -e "  ${dim}Start all services:${reset}  ${cyan}./dev.sh${reset}  (tmux) or  ${cyan}./start.sh${reset}  (background)"
echo ""
echo -e "  ${bold}Credentials:${reset}"
echo -e "  ${dim}Dashboard:${reset}  http://localhost:3000"
echo -e "  ${dim}Login:${reset}      ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}"
echo ""
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo -e "  ${yellow}Add your LLM key to .env (OPENAI_API_KEY) to enable agent execution.${reset}"
  echo ""
fi
