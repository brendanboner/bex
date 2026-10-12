FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g turbo

FROM base AS builder
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/credential-vault/package.json ./packages/credential-vault/
COPY packages/permission-gateway/package.json ./packages/permission-gateway/
COPY packages/skill-engine/package.json ./packages/skill-engine/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY packages/coordinator/package.json ./packages/coordinator/
COPY packages/persona-factory/package.json ./packages/persona-factory/
COPY packages/knowledge-store/package.json ./packages/knowledge-store/
COPY packages/agent-mesh/package.json ./packages/agent-mesh/
COPY packages/ssh-executor/package.json ./packages/ssh-executor/
COPY packages/skill-registry-client/package.json ./packages/skill-registry-client/
COPY packages/dashboard-api/package.json ./packages/dashboard-api/
COPY packages/api-gateway/package.json ./packages/api-gateway/
RUN npm install --workspaces --include-workspace-root

COPY packages/ ./packages/
RUN turbo run build --filter=@bclaw/scheduler

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/scheduler/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "dist/worker.js"]
