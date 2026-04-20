# Forge — Makefile

.PHONY: install bootstrap start stop restart status logs build test db-studio db-migrate db-reset clean help

##@ First-time Setup

install: ## Install dependencies, build all packages, and link bex globally
	@echo "📦 Installing dependencies..."
	npm install --loglevel=error
	@echo "🔨 Building all packages..."
	npm run build --silent
	@echo "🔗 Linking bex CLI globally..."
	cd packages/cli && npm link --loglevel=error
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
	docker compose -f infra/docker-compose.yml down -v
	@echo "🗑️  All Docker volumes removed."

##@ Help

help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
