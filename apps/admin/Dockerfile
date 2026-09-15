# Build context is the WORKSPACE ROOT, not apps/admin — the build needs the Nx
# config, the root lockfile and libs/contracts.
#
#   docker build -f apps/admin/Dockerfile -t transacto-admin .

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /workspace

# Copy every workspace manifest first so `npm ci` is cached independently of
# source changes. All of them, even though only two are built: npm resolves the
# whole workspace graph, and a manifest the lockfile knows about but the image
# does not have is an `npm ci` failure.
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json                apps/api/
COPY apps/monobank-extension/package.json apps/monobank-extension/
COPY apps/telegram-mini-app/package.json  apps/telegram-mini-app/
COPY apps/admin/package.json              apps/admin/
COPY libs/contracts/package.json          libs/contracts/

RUN npm ci --include-workspace-root \
      --workspace=@transacto/admin \
      --workspace=@transacto/contracts

COPY . .

# `baseHref: /admin/` is baked in by the build target, so every hashed bundle is
# requested under that prefix — see the Caddyfile for the other half.
ARG CONFIGURATION=production
RUN npx nx build admin --skip-nx-cache --configuration=${CONFIGURATION}

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM caddy:alpine

# The Angular application builder outputs to dist/browser when `outputPath.base`
# is set.
COPY --from=builder /workspace/apps/admin/dist/browser /usr/share/caddy

COPY apps/admin/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
