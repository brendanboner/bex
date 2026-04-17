#!/usr/bin/env bash
set -e

echo "Running database migrations..."
cd packages/shared
DATABASE_URL="${DATABASE_URL}" npx prisma migrate deploy

echo "Seeding database..."
DATABASE_URL="${DATABASE_URL}" npx prisma db seed 2>/dev/null || true

echo "Database ready."
