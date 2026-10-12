# Forge — Makefile

SHELL := /bin/bash

.PHONY: install bootstrap start stop restart status logs build test db-studio db-migrate db-reset clean help

##@ First-time Setup

install: ## Install dependencies, build all packages, and link bex globally
	@echo "📦 Installing dependencies..."
	@npm install --no-audit --no-fund 2>&1 | grep -Ev "^npm (warn|notice)" | grep -v "^$$" || true
	@echo "⚙️  Generating Prisma client..."
	@cd packages/shared && npx prisma generate --schema=prisma/schema.prisma 2>&1 \
	  | grep -E "✔|error|Error" || true
	@echo "🔨 Building all packages..."
	@npm run build -- --ui=stream 2>&1 \
	  | tee /tmp/forge-build.log \
	  | grep --line-buffered -E "^\s+(Tasks:|Cached:|Time:)|error TS[0-9]+" \
	  | sed 's/^/  /'; \
	  if [ $${PIPESTATUS[0]} -ne 0 ]; then \
	    echo ""; echo "❌ Build failed. Errors:"; \
	    grep -E "error TS[0-9]+|^error" /tmp/forge-build.log | head -20; \
	    exit 1; \
	  fi
	@echo "🔗 Linking bex globally..."
	@chmod +x packages/cli/dist/bin/bex.js
	@cd packages/cli && npm link --force --loglevel=error --no-audit > /dev/null 2>&1
	@echo ""
	@echo "✅ Done! Run: bex init"

##@ Running

start: ## Start all services (alias for: bex start)
	bex start

stop: ## Stop all services (alias for: bex stop)
	bex stop

restart: ## Restart all services (alias for: bex restart)
	bex restart

status: ## Health-check all services (alias for: bex status)
	bex status

logs: ## Tail all service logs (alias for: bex logs)
	bex logs

##@ Development

build: ## Build all packages
	npm run build

test: ## Run all tests
	npm run test

##@ Database

db-studio: ## Open Prisma Studio
	cd packages/shared && npx prisma studio

db-migrate: ## Run pending migrations
	cd packages/shared && npx prisma migrate deploy

db-reset: ## Reset database — WARNING: destroys all data
	cd packages/shared && npx prisma migrate reset --force

##@ Cleanup

clean: ## Stop services and remove Docker data volumes
	docker compose -f docker-compose.infra.yml down -v
	@echo "🗑️  All Docker volumes removed."

clean-all: ## Stop ALL services (full Docker mode) and remove volumes
	docker compose down -v
	@echo "🗑️  All Docker volumes removed."

##@ Help

help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
