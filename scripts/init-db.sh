#!/usr/bin/env bash
# init-db.sh — Run Prisma migrations and seed the database
# Expects DATABASE_URL to be set in environment or .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# Load .env if present and DATABASE_URL not already set
if [[ -f "$ENV_FILE" && -z "${DATABASE_URL:-}" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL is not set. Either set it in .env or as an environment variable."
  exit 1
fi

echo "🗄️  Running database migrations..."
cd "$REPO_ROOT/packages/shared"
npx prisma migrate deploy 2>&1 || {
  echo "⚠️  migrate deploy failed (DB may be fresh). Trying migrate dev..."
  npx prisma migrate dev --name init --skip-seed
}

echo "🌱 Running database seed..."
npx prisma db seed 2>&1 || echo "⚠️  Seed skipped (may have already run)"

echo "✅ Database ready."
