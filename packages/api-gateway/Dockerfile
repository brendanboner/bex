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
COPY packages/api-gateway/package.json ./packages/api-gateway/
COPY packages/scheduler/package.json ./packages/scheduler/
RUN npm install --workspaces --include-workspace-root

COPY packages/ ./packages/
RUN turbo run build --filter=@bclaw/api-gateway

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/api-gateway/dist ./dist
COPY --from=builder /app/packages/api-gateway/package.json ./
COPY --from=builder /app/packages/shared/dist ./node_modules/@bclaw/shared/dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4000
CMD ["node", "dist/server.js"]
