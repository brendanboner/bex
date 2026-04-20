FROM node:20-alpine AS builder

WORKDIR /app

# Build tools needed for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy workspace root and registry package
COPY package.json package-lock.json ./
COPY packages/skill-registry ./packages/skill-registry
COPY packages/shared ./packages/shared

# Install all dependencies (workspace-aware), allowing scripts so native modules build
RUN npm ci --workspace=packages/skill-registry --workspace=packages/shared

# Build shared first, then registry
RUN npm run build --workspace=packages/shared 2>/dev/null || true
RUN npm run build --workspace=packages/skill-registry

# ─── Runtime image ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Runtime libs for better-sqlite3 native module
RUN apk add --no-cache libstdc++

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/skill-registry/dist ./packages/skill-registry/dist
COPY --from=builder /app/packages/skill-registry/package.json ./packages/skill-registry/package.json

ENV NODE_ENV=production
ENV PORT=5050

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:5050/health || exit 1

CMD ["node", "packages/skill-registry/dist/server.js"]
