# Build context is the WORKSPACE ROOT, not apps/api — the build needs the Nx
# config, the root lockfile and libs/contracts.
#
#   docker build -f apps/api/Dockerfile -t transacto-api .

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /workspace

# Copy every workspace manifest first so `npm ci` is cached independently of
# source changes. npm workspaces resolves the whole graph, so all of them must
# be present even though only api and contracts are built.
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json                apps/api/
COPY apps/monobank-extension/package.json apps/monobank-extension/
COPY apps/telegram-mini-app/package.json  apps/telegram-mini-app/
COPY apps/admin/package.json              apps/admin/
COPY libs/contracts/package.json          libs/contracts/

# Only api + contracts, never the two Angular apps: their toolchains (Angular
# compiler, vitest, esbuild) are not used to build the backend. Every workspace
# manifest is still copied above, because npm resolves the whole workspace graph
# even when installing a subset of it.
RUN npm ci --include-workspace-root \
      --workspace=@transacto/api \
      --workspace=@transacto/contracts

COPY . .

# `prune` = build + prune-lockfile + copy-workspace-modules. It emits a
# self-contained apps/api/dist containing main.js and a package.json whose
# @transacto/contracts dependency points at ./workspace_modules.
RUN npx nx prune api --skip-nx-cache

# Install production dependencies into the pruned output.
#
# The lockfile @nx/js:prune-lockfile emits is discarded: it omits
# @transacto/contracts entirely and pins transitive versions that contradict the
# app's own ranges (e.g. https-proxy-agent 5.0.1 against a ^9.1.0 requirement),
# so `npm ci` rejects it. The pruned package.json itself is correct, so resolve
# from that. The build above is still lockfile-pinned via the root `npm ci`.
WORKDIR /workspace/apps/api/dist
RUN rm -f package-lock.json \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
# node:24 ships npm 11, matching the npm that wrote package-lock.json. On
# node:22 (npm 10) `npm ci` fails with EUSAGE / "Missing: chokidar… from lock
# file" purely from lockfile-format skew.
FROM node:24-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

# The pruned output already carries main.js, its package.json, the vendored
# @transacto/contracts under workspace_modules, and installed node_modules.
COPY --from=builder /workspace/apps/api/dist ./

# Matches PORT in src/environments
EXPOSE 8000

CMD ["node", "main.js"]
