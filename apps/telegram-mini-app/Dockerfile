# Build context is the WORKSPACE ROOT, not apps/telegram-mini-app — the build needs the Nx
# config, the root lockfile and libs/contracts.
#
#   docker build -f apps/telegram-mini-app/Dockerfile -t transacto-tma .

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /workspace

# Copy every workspace manifest first so `npm ci` is cached independently of
# source changes.
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json                apps/api/
COPY apps/monobank-extension/package.json apps/monobank-extension/
COPY apps/telegram-mini-app/package.json  apps/telegram-mini-app/
COPY apps/admin/package.json              apps/admin/
COPY libs/contracts/package.json          libs/contracts/

# Install dependencies for the frontend and shared contracts
RUN npm ci --include-workspace-root \
      --workspace=@transacto/telegram-mini-app \
      --workspace=@transacto/contracts

COPY . .

# Build the Angular application
ARG CONFIGURATION=production
RUN npx nx build telegram-mini-app --skip-nx-cache --configuration=${CONFIGURATION}

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM caddy:alpine

# The Angular v17+ application builder outputs to dist/browser
# (when outputPath.base is set to apps/telegram-mini-app/dist)
COPY --from=builder /workspace/apps/telegram-mini-app/dist/browser /usr/share/caddy

# Copy custom Caddy configuration for SPA routing
COPY apps/telegram-mini-app/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
