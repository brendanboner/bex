# OpenClaw — Makefile

.PHONY: setup dev prod stop clean build test logs help

##@ Setup

setup: ## First-time setup: generate secrets and create .env
	@echo "🔐 Generating secrets..."
	@bash scripts/generate-env.sh
	@echo ""
	@echo "✅ .env created. Edit it to add your LLM API keys and notification tokens."
	@echo "   Then run: make run"

##@ Running

run: ## Start all services (builds if needed)
	@echo "🚀 Starting OpenClaw..."
	docker compose up -d --build
	@echo ""
	@echo "⏳ Waiting for services to be ready..."
	@sleep 8
	@bash scripts/init-db.sh
	@echo ""
	@echo "✅ OpenClaw is running!"
	@echo "   Dashboard:    http://localhost:3000"
	@echo "   API:          http://localhost:4000"
	@echo "   Admin API:    http://localhost:4001"
	@echo ""
	@echo "   Default admin token is in .env as BCLAW_ADMIN_TOKEN"

run-with-telegram: ## Start all services including the Telegram bot
	docker compose --profile telegram up -d --build
	@bash scripts/init-db.sh

dev: ## Start services for local development (no dashboard build)
	docker compose up -d postgres redis
	@echo "▶  Run: npm run dev"

stop: ## Stop all services
	docker compose down

clean: ## Stop and remove all data volumes
	docker compose down -v
	@echo "🗑️  All data removed."

restart: ## Restart all services
	docker compose restart

##@ Development

build: ## Build all packages
	npm run build

test: ## Run all tests
	npm run test

logs: ## Tail all service logs
	docker compose logs -f

logs-api: ## Tail api-gateway logs
	docker compose logs -f api-gateway

db-studio: ## Open Prisma Studio (requires DATABASE_URL to be set)
	cd packages/shared && npx prisma studio

db-migrate: ## Run pending migrations
	@bash scripts/init-db.sh

db-reset: ## Reset database (WARNING: destroys all data)
	cd packages/shared && npx prisma migrate reset --force

##@ Help

help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
