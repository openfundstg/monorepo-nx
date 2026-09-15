# `deploy/inspect/` — read-only production access

A way to look at production — logs, MongoDB, Redis — that **cannot change it**,
so it can be handed to an agent or run half-asleep at 2am without a second
thought.

```sh
./deploy/inspect.sh ps
./deploy/inspect.sh logs api --since 30m --grep 'FRAUD|NovaPay'
./deploy/inspect.sh mongo find tma_sales '{"publicId":"8GJPNPDY"}'
./deploy/inspect.sh mongo aggregate tma_users '[{"$group":{"_id":null,"n":{"$sum":1}}}]'
./deploy/inspect.sh redis get 'terminal:baseline:28304'
./deploy/inspect.sh help
```

## What actually stops a write

Not the client script. `deploy/inspect.sh` only encodes arguments and calls ssh;
editing it, or ignoring it and calling ssh directly, changes nothing. Three
things on the server do the work, and each one holds on its own:

1. **The key can only run one program.** `command="/usr/local/bin/transacto-inspect"`
   in the inspector's `authorized_keys` means sshd runs that script and passes
   whatever was typed in `SSH_ORIGINAL_COMMAND`. There is no shell, no port
   forwarding and no pty on that key. `ssh inspector@host 'id'` runs the script
   with `id` as its argument, and the script does not have an `id` command.
2. **The credentials cannot write.** The Mongo account holds `role: read`; the
   Redis account is `-@all +@read +info +ping`. Verified, not assumed — `SET`,
   `DEL`, `FLUSHALL`, `CONFIG GET` and `EXPIRE` all answer `NOPERM`, and an
   `insertOne` answers `Unauthorized`. So even a bug in the script cannot change
   production.
3. **Credentials never leave the box.** Every document is walked on the server
   and any field named `cred1..cred3`, `apiToken`, `recipientCard`, `iban`,
   `recipientCode`, `dropLink`, `checkUrl`, `receipts`, `initData`, `token`,
   `hash`, `phone` (and the rest of the list in the script) is replaced with
   `[redacted]` — at any depth, including inside arrays. Log lines get card-shaped
   digit runs masked on the way out. This is the repo's own rule about card
   numbers never reaching a log line, applied to the one path that carries a log
   line off the server.

What it is **not**: a shell with training wheels. Adding a capability means
editing `transacto-inspect` and reinstalling it — deliberately, because the list
of what is reachable should be a thing somebody chose.

---

## Using it from Claude Code

The point of the design is that this is safe to hand to an agent, so it is
allowlisted in [`.claude/settings.json`](../../.claude/settings.json):

```json
"permissions": { "allow": ["Bash(./deploy/inspect.sh:*)"] }
```

That makes it behave like an MCP tool — reached when it is needed, without an
approval prompt per call. **What makes that safe is that the rule grants nothing
the server would not already allow.** Every argument still lands in the forced
command's allowlist, under credentials that cannot write. Allowlisting the
client is not a security decision; it just stops asking a question whose answer
is fixed on the far side.

`CLAUDE.md` names the tool so a session knows it exists without being told.

If you want the boundary to hold against an agent reaching around the script as
well, add a matching deny for raw ssh:

```json
"permissions": { "deny": ["Bash(ssh:*)"] }
```

Worth knowing before you do: it also blocks the ssh in `migrate.sh` and any
other legitimate ssh you might ask for.

---

## Setting it up

`setup-server.sh` is the whole checklist below, in the one order that is safe,
and idempotent — so this is normally two commands rather than twenty minutes:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/transacto_inspect -C transacto-inspect -N ''
ssh YOUR-PROD-HOST "cd /var/www/monorepo-nx && git pull && \
  sudo bash deploy/inspect/setup-server.sh '$(cat ~/.ssh/transacto_inspect.pub)'"
```

Then fill in `deploy/inspect.env` from `inspect.env.example` and run
`./deploy/inspect.sh ps`.

The script generates both database passwords on the server and never prints
them: they go straight into `/etc/transacto-inspect.env` and, for Redis, into
the compose `.env`. Nothing that runs it ever sees them.

The rest of this section is what it does, step by step, for when it fails or
when the server is not this one.

### 1. A key, on your machine

```sh
ssh-keygen -t ed25519 -f ~/.ssh/transacto_inspect -C transacto-inspect -N ''
cp deploy/inspect.env.example deploy/inspect.env   # then fill in the two values
```

`deploy/inspect.env` is gitignored. Its host is `inspector@…`, **not** your own
login — pointing it at your own account gives you an unrestricted ssh with extra
steps.

### 2. The account, on the server

```sh
sudo useradd --create-home --shell /bin/bash inspector
sudo usermod -aG docker inspector
```

A real shell, because sshd needs one to run a forced command; the forced command
is what makes the shell unreachable. The `docker` group is what lets it read
container logs, and it is why steps 3 and 4 are not optional: `docker` is root,
and the only thing standing between this key and that is the forced command.

### 3. The forced command

```sh
sudo mkdir -p /home/inspector/.ssh
sudo tee /home/inspector/.ssh/authorized_keys >/dev/null <<'EOF'
command="/usr/local/bin/transacto-inspect",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA…PASTE…  transacto-inspect
EOF
sudo chown root:root /home/inspector/.ssh/authorized_keys
sudo chmod 644 /home/inspector/.ssh/authorized_keys
sudo chown inspector:inspector /home/inspector/.ssh && sudo chmod 700 /home/inspector/.ssh
```

Paste the **public** half of the key from step 1 (`~/.ssh/transacto_inspect.pub`).

`authorized_keys` is owned by **root**, not by `inspector`, and that is on
purpose: sshd accepts either, and root ownership means the account cannot
rewrite its own entry to drop the forced command. sshd's `StrictModes` only
requires that it not be group- or world-writable.

### 4. The script

```sh
cd /var/www/monorepo-nx && git pull
sudo install -o root -g root -m 755 deploy/inspect/transacto-inspect /usr/local/bin/transacto-inspect
```

Root-owned and not writable by `inspector` — same reason as above. Reinstall it
whenever it changes; nothing does that automatically.

### 5. A read-only MongoDB account

```sh
cd /var/www/monorepo-nx
set -a && . ./.env && set +a
MONGO_INSPECT_PASS="$(openssl rand -hex 24)" && echo "save this: $MONGO_INSPECT_PASS"

docker compose exec -T mongodb mongosh --quiet \
  -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASS" --authenticationDatabase admin \
  "$MONGO_DB_NAME" --eval "db.createUser({user:'inspector',pwd:'$MONGO_INSPECT_PASS',roles:[{role:'read',db:'$MONGO_DB_NAME'}]})"
```

`role: read` on the application database only — no `admin`, no other database,
no write of any kind.

### 6. A read-only Redis account

`docker-compose.yml` already declares it; it needs a password in the server's
`.env`:

```sh
echo "REDIS_INSPECT_PASSWORD=$(openssl rand -hex 24)" >> /var/www/monorepo-nx/.env
docker compose up -d redis
```

Redis **refuses to start** without that variable rather than starting with an
account that has an empty password — so a missing value is a failed deploy, not
a quiet hole.

Recreating the container restarts Redis. That is safe: it holds caches plus the
scrapers' balance baselines, it snapshots to the `redis_data` volume on a clean
shutdown, and a lost baseline re-initialises on the next scrape. Still worth
doing at a quiet moment rather than mid-settlement.

### 7. Wire the two together

```sh
sudo tee /etc/transacto-inspect.env >/dev/null <<EOF
TRANSACTO_DIR=/var/www/monorepo-nx
MONGO_DB_NAME=$MONGO_DB_NAME
MONGO_INSPECT_USER=inspector
MONGO_INSPECT_PASS=$MONGO_INSPECT_PASS
REDIS_INSPECT_USER=inspector
REDIS_INSPECT_PASS=<the value from step 6>
EOF
sudo chown root:inspector /etc/transacto-inspect.env
sudo chmod 640 /etc/transacto-inspect.env
```

Readable by the script, writable only by root. These are read-only credentials,
so the file leaking is not a breach — but it should still not be editable by the
account that reads it.

### 8. Check that it works, and that it stops

```sh
./deploy/inspect.sh ps                 # containers
./deploy/inspect.sh mongo collections  # every collection with a document count
./deploy/inspect.sh redis dbsize
./deploy/inspect.sh logs api --tail 20

# …and the half that matters more:
ssh -i ~/.ssh/transacto_inspect inspector@HOST 'id'
#   → transacto-inspect: unknown command 'id' — run 'help' for the list
ssh -i ~/.ssh/transacto_inspect inspector@HOST
#   → prints the usage and exits; no shell
```

If the last two give you a shell, the forced command is not in place — stop and
fix step 3 before using any of this.

---

## Reference

| Command | |
|---|---|
| `ps` | containers, status, health |
| `logs <service> [--since 30m] [--tail 200] [--grep RE]` | `api`, `telegram-mini-app`, `admin`, `mongodb`, `redis`, `receipt-checker`. With `--grep` the whole `--since` window is searched and `--tail` trims the *answer*; without it, `--tail` trims the read. |
| `mongo collections` | every collection with its document count |
| `mongo count <coll> [filter]` | |
| `mongo find <coll> [filter] [--limit 20] [--sort JSON] [--fields a,b]` | |
| `mongo aggregate <coll> <pipeline> [--limit 20]` | read stages only — `$out`, `$merge`, `$function`, `$where` are refused by name |
| `mongo indexes <coll>` | |
| `redis scan <pattern> [--count N]` | `SCAN`, never `KEYS` — this Redis is in the request path of every scrape |
| `redis get <key>` | reads whichever type the key is |
| `redis ttl <key>` · `redis dbsize` · `redis info [section]` | |

Filters and pipelines are **extended** JSON, so `{"_id":{"$oid":"…"}}` and
`{"createdAt":{"$gt":{"$date":"2026-09-01T00:00:00Z"}}}` work.

Limits are capped rather than merely defaulted — 200 documents, 2000 log lines.
The usual reader is an agent with a context window, and an unbounded `find` on a
live collection is a denial of service against whoever is reading it.

### Arguments never become syntax

The client base64-encodes each argument; the server decodes them into an array.
Nothing is re-split, nothing is `eval`-ed. A Mongo filter reaches `mongosh`
through the **environment** and is read with `process.env` and `EJSON.parse` —
data at every step, never spliced into the script being evaluated. That is why a
filter containing quotes, braces, `$` or a semicolon is just a filter.
