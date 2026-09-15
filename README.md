# Transacto

Nx monorepo holding the backend, both frontends, and the shared wire contracts between them.

| Project                | Path                      | Stack                                             |
| ---------------------- | ------------------------- | ------------------------------------------------- |
| `api`                  | `apps/api`                | NestJS 11 · Express · MongoDB · Redis/BullMQ      |
| `monobank-extension`   | `apps/monobank-extension` | Angular 22 · Chrome MV3 extension                 |
| `telegram-mini-app`    | `apps/telegram-mini-app`  | Angular 22 · Telegram Mini App                    |
| `admin`                | `apps/admin`              | Angular 22 · Material · NgRx · served at `/admin` |
| `@transacto/contracts` | `libs/contracts`          | Plain TypeScript — types shared across all three  |

## Getting started

```sh
npm install

cp .env.example .env                  # compose-level: Mongo/Redis credentials
# apps/api/src/environments/.env      # application config (not in git)
```

## Commands

```sh
npx nx run-many -t build --all        # build everything
npx nx affected -t build              # build only what changed
npx nx serve api                      # backend
npx nx serve telegram-mini-app        # mini app dev server (proxies to :8000)
npx nx serve admin                    # admin panel dev server (proxies to :8000)
npx nx build-extension monobank-extension   # loadable unpacked extension → dist/
npx nx test monobank-extension
npx nx lint api
npx nx typecheck api                  # required — `nx build api` does not check types
npx nx graph                          # visualise project dependencies

npx nx run-many -t lint typecheck build test   # the full gate, all 5 projects
```

Run tasks through `nx`, not the underlying tooling, so the dependency graph and cache apply.

**Loading the extension:** build with `build-extension` (not `build` — that skips the service
worker), then in Chrome go to `chrome://extensions`, enable Developer mode, and _Load unpacked_
from `apps/monobank-extension/dist`.

Both frontends build production by default — the extension bakes in `environment.prod.ts` and
emits no source maps. For a local build pointing at `http://localhost:8000`:

```sh
npx nx build-extension monobank-extension --configuration=development
```

The mini app deploys from `apps/telegram-mini-app/dist/browser`.

## Docker

```sh
docker compose up                     # mongodb + redis + api + mini app + admin
```

The API image builds from the workspace root, since it needs `nx.json`, the root lockfile and
`libs/contracts`.

Published ports are loopback-only and overridable — set `MONGO_HOST_PORT`, `REDIS_HOST_PORT`,
`API_HOST_PORT`, `TMA_HOST_PORT` or `ADMIN_HOST_PORT` in `.env` if something already owns the
default on your machine.

The admin panel serves static files only, at `/admin`. The host reverse proxy routes `/admin*`
to it and `/api/*` + `/socket.io*` to the API — all on one hostname, because the panel
authenticates with a cookie and the API does not allow credentialed cross-origin requests. The containers
reach each other by service name, so changing these affects only your own tooling.

## Docs

- [CLAUDE.md](./CLAUDE.md) — workspace rules, boundaries, gotchas
- [CONTRACTS.md](./CONTRACTS.md) — what belongs in `@transacto/contracts` and why
- `apps/*/CLAUDE.md` — per-project coding rules
- `apps/*/REFACTORING.md` — known divergences, a backlog rather than precedent
