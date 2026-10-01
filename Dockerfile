# syntax=docker/dockerfile:1
# HALCYON FRONT — production image: builds the client (Vite) + server bundle
# (esbuild), then ships only dist/ and production node_modules (ws) on a
# minimal non-root runtime.

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
# Playwright is a dev dependency for e2e tests only; never download browsers here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Offline admin code baked (hashed) into the client: docker build --build-arg VITE_ADMIN_CODE=...
ARG VITE_ADMIN_CODE
RUN npm run build && npm prune --omit=dev

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Accounts store (mount a volume here to persist accounts across deploys).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
# Exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown flushes accounts).
CMD ["node", "dist/server/index.js"]
