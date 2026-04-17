FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g turbo

FROM base AS builder
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
RUN npm install --workspaces --include-workspace-root
RUN turbo run build --filter=@bclaw/scheduler

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/scheduler/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "dist/worker.js"]
