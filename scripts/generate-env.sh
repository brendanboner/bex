#!/usr/bin/env bash
# generate-env.sh — Creates a .env file with secure auto-generated secrets
# Safe to re-run: will not overwrite an existing .env unless --force is passed

set -euo pipefail

FORCE=${1:-}
ENV_FILE="$(dirname "$0")/../.env"
EXAMPLE_FILE="$(dirname "$0")/../.env.example"

if [[ -f "$ENV_FILE" && "$FORCE" != "--force" ]]; then
  echo "⚠️  .env already exists. Run with --force to regenerate."
  exit 0
fi

if ! command -v openssl &>/dev/null; then
  echo "❌ openssl is required but not installed."
  exit 1
fi

echo "📋 Generating .env from .env.example with secure secrets..."

# Copy the example file as a base
cp "$EXAMPLE_FILE" "$ENV_FILE"

# Generate secure random values
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
CREDENTIAL_VAULT_KEY=$(openssl rand -hex 32)
BCLAW_ADMIN_TOKEN=$(openssl rand -hex 24)

# Replace placeholder values
sed -i.bak \
  -e "s|POSTGRES_PASSWORD=change-me-strong-password|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|REDIS_PASSWORD=change-me-redis-password|REDIS_PASSWORD=${REDIS_PASSWORD}|" \
  -e "s|JWT_SECRET=change-me-jwt-secret|JWT_SECRET=${JWT_SECRET}|" \
  -e "s|CREDENTIAL_VAULT_KEY=change-me-64-hex-chars-credential-vault-key-000000000000000000000|CREDENTIAL_VAULT_KEY=${CREDENTIAL_VAULT_KEY}|" \
  "$ENV_FILE"

# Append admin token if not present
if ! grep -q "BCLAW_ADMIN_TOKEN" "$ENV_FILE"; then
  echo "" >> "$ENV_FILE"
  echo "# Pre-generated admin JWT (use this to authenticate to the API on first login)" >> "$ENV_FILE"
  echo "BCLAW_ADMIN_TOKEN=${BCLAW_ADMIN_TOKEN}" >> "$ENV_FILE"
fi

rm -f "${ENV_FILE}.bak"

echo ""
echo "✅ Generated:"
echo "   POSTGRES_PASSWORD  = ${POSTGRES_PASSWORD}"
echo "   REDIS_PASSWORD     = ${REDIS_PASSWORD}"
echo "   JWT_SECRET         = ${JWT_SECRET:0:16}... (truncated)"
echo "   CREDENTIAL_VAULT_KEY = ${CREDENTIAL_VAULT_KEY:0:16}... (truncated)"
echo "   BCLAW_ADMIN_TOKEN  = ${BCLAW_ADMIN_TOKEN:0:16}... (truncated)"
echo ""
echo "⚡ Still required — add your LLM keys to .env:"
echo "   OPENAI_API_KEY      (or ANTHROPIC_API_KEY)"
echo "   TELEGRAM_BOT_TOKEN  (if using Telegram)"
echo "   TEAMS_APPROVAL_WEBHOOK_URL  (if using Teams)"
