# `deploy/`

Host-level configuration that lives outside the containers.

## `Caddyfile`

The edge for `openfunds.top`. It terminates TLS and decides which of the three
containers answers a request:

| Path                    | Container         | Port |
| ----------------------- | ----------------- | ---- |
| `/api/*`, `/socket.io*` | `transacto-api`   | 8000 |
| `/admin`, `/admin/*`    | `transacto-admin` | 8090 |
| everything else         | `transacto-tma`   | 8080 |

**All three must stay on one hostname.** The admin panel authenticates with a
cookie and the API deliberately does not send `Access-Control-Allow-Credentials`,
so a panel served from another origin arrives unauthenticated — see the CORS note
in `apps/api/src/main.ts`.

Installing:

```sh
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`caddy fmt` is worth running: `caddy validate` warns about formatting rather than
failing, so an unformatted file reloads fine and the warning is easy to ignore
forever.

## Looking at production

`inspect.sh` reads production and cannot change it — logs, MongoDB and Redis,
through an ssh key pinned to one allowlist, under database accounts that hold no
write permission, with payment credentials stripped from every document before
it leaves the server.

```sh
./deploy/inspect.sh logs api --since 30m --grep FRAUD
./deploy/inspect.sh mongo find tma_sales '{"publicId":"8GJPNPDY"}'
./deploy/inspect.sh redis get 'terminal:baseline:28304'
```

It needs a one-time setup on the server — the account, the forced command, the
two read-only database users. [`inspect/README.md`](./inspect/README.md) is the
checklist, and explains which of those three actually stops a write (all of
them, independently).

## Migrations

Data migrations live in `apps/api/src/migrations` and ship **inside the API
bundle**: the runtime image carries `main.js`, its production dependencies and
nothing else, so `main.js` is also the tool that runs them.

```sh
docker compose run --rm -T api node main.js migrate status   # what has run
docker compose run --rm -T api node main.js migrate up        # run what is pending
docker compose run --rm -T api node main.js migrate down      # reverse the last one
docker compose run --rm -T api node main.js migrate unlock    # after a run that died
```

`migrate.sh` is the same thing from your own machine, so a migration is one
command rather than an ssh session:

```sh
export TRANSACTO_HOST=root@openfunds.top   # TRANSACTO_DIR defaults to /srv/transacto
./deploy/migrate.sh status
./deploy/migrate.sh up
```

A one-off container (`run --rm`), not the running one (`exec`): the migration
needs the database and nothing else, and a container that exits is easier to
reason about than a process sharing the API's lifetime. Compose starts `mongodb`
if it is not already up.

> ⚠️ **`git pull` does not update a migration. Rebuild the image.**
>
> Migrations ship _inside_ `main.js`, so the code that runs is the code in the
> **built image**, not the code in the checkout. Pulling and running
> `migrate up` re-runs whatever the last build contained — which is how the
> first version of `0003` was run twice against production after it had already
> been fixed in git. Every migration run starts with:
>
> ```sh
> cd /var/www/monorepo-nx && git pull && docker compose build api
> ```

**`0003` reprices every sale and must run before the new code serves traffic.**
It rewrites `exchangeRate` from the market rate to the sell rate and drops
`profitPercent` / `expectedProfit`. An API on the new code reading an
unconverted order would settle it at the market — the exact bug the change
removes — so deploy, stop the API, migrate, start it again:

```sh
cd /var/www/monorepo-nx
git pull && docker compose build api    # the migration lives in the image
docker compose stop api
docker compose run --rm -T api node main.js migrate up
docker compose up -d api
```

**Stop the API for a migration that recomputes from balances.** `0001` is one:
it books each user's difference between their balance and what it could
reconstruct, so a movement landing inside that read leaves one user out by its
amount.

```sh
ssh $TRANSACTO_HOST 'cd /srv/transacto && docker compose stop api'
./deploy/migrate.sh up
ssh $TRANSACTO_HOST 'cd /srv/transacto && docker compose start api'
```

Locally, against whatever `DB_URL` points at:

```sh
npx nx db-migrate api -- status
npx nx db-migrate api -- up
```

Three things the runner guarantees, so that neither of the above needs care:

- **A migration runs once.** The `migrations` collection records what has run,
  by name. A run that dies records nothing, so it is pending again — which is
  why every migration is written to survive being run twice.
- **Two runs cannot overlap.** The first takes a lock document; the second is
  refused and told who holds it. A run killed outright leaves the lock standing
  on purpose: somebody should look at what it managed to do before the next one
  starts. `unlock` is that decision.
- **The API says when something is pending.** It logs a warning naming them on
  boot — it never runs them.
