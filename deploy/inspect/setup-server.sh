#!/usr/bin/env bash
#
# Sets up read-only production access, on the server, in one command.
#
#   scp ~/.ssh/transacto_inspect.pub vlados:/tmp/
#   ssh vlados 'sudo bash /var/www/monorepo-nx/deploy/inspect/setup-server.sh "$(cat /tmp/transacto_inspect.pub)"'
#
# What it does is the checklist in README.md, in the one order that is safe:
# the Redis password exists before the code that requires it, and the code is
# in place before the container that runs it is recreated.
#
# Idempotent — every step checks for its own result first, so a re-run after a
# failure picks up where it stopped and a re-run after success changes nothing.
# It never prints a credential it generates.
set -euo pipefail

readonly PUBLIC_KEY="${1:-}"
readonly PROJECT_DIR="${TRANSACTO_DIR:-/var/www/monorepo-nx}"
readonly CONFIG_FILE=/etc/transacto-inspect.env
readonly ACCOUNT=inspector

[ "$(id -u)" -eq 0 ] || { echo "run me with sudo" >&2; exit 1; }
[ -n "$PUBLIC_KEY" ] || { echo "usage: $0 '<the contents of transacto_inspect.pub>'" >&2; exit 1; }
[[ "$PUBLIC_KEY" == ssh-* ]] || { echo "that does not look like a public key" >&2; exit 1; }

cd "$PROJECT_DIR"

step() { printf '\n== %s\n' "$*"; }

# --- 1. the Redis password, before anything needs it -------------------------
#
# docker-compose.yml requires this variable and refuses to interpolate without
# it. That refusal happens while the config is being read, before any container
# is touched — so getting the order wrong is a failed command, not an outage.
step '1. REDIS_INSPECT_PASSWORD'
if grep -q '^REDIS_INSPECT_PASSWORD=' .env; then
  echo '   already present, left alone'
else
  printf '\n# Read-only Redis account for deploy/inspect.sh.\nREDIS_INSPECT_PASSWORD=%s\n' \
    "$(openssl rand -hex 24)" >>.env
  echo '   generated and appended'
fi
set -a && . ./.env && set +a

step '2. compose can read its own config'
docker compose config --quiet
echo '   ok'

# --- 3. the Redis account ----------------------------------------------------
step '3. the inspector Redis user'
docker compose up -d redis
# Redis needs a moment to accept connections after a recreate; the check below
# is the real gate, so this is a floor rather than a guess.
sleep 3
if docker compose exec -T redis redis-cli --user inspector --pass "$REDIS_INSPECT_PASSWORD" \
  --no-auth-warning SET probe 1 2>&1 | grep -q NOPERM; then
  echo '   present, and it cannot write'
else
  echo '   FAILED: the inspector user can write, or does not exist' >&2
  exit 1
fi

# --- 4. the OS account -------------------------------------------------------
step "4. the $ACCOUNT account"
if id -u "$ACCOUNT" >/dev/null 2>&1; then
  echo '   already exists'
else
  # A real shell, because sshd needs one to run a forced command. The forced
  # command is what makes the shell unreachable.
  useradd --create-home --shell /bin/bash "$ACCOUNT"
  echo '   created'
fi
# Reading container logs needs the docker group, and docker is root — which is
# why the forced command below is not optional.
usermod -aG docker "$ACCOUNT"

# --- 5. the forced command ---------------------------------------------------
step '5. the key, pinned to one program'
install -d -o "$ACCOUNT" -g "$ACCOUNT" -m 700 "/home/$ACCOUNT/.ssh"
# Owned by root, not by the account: sshd accepts either, and root ownership
# means this account cannot rewrite its own entry to drop the forced command.
cat >"/home/$ACCOUNT/.ssh/authorized_keys" <<KEY
command="/usr/local/bin/transacto-inspect",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding $PUBLIC_KEY
KEY
chown root:root "/home/$ACCOUNT/.ssh/authorized_keys"
chmod 644 "/home/$ACCOUNT/.ssh/authorized_keys"
echo '   written, root-owned'

step '6. the script'
install -o root -g root -m 755 "$PROJECT_DIR/deploy/inspect/transacto-inspect" /usr/local/bin/transacto-inspect
echo '   installed at /usr/local/bin/transacto-inspect'

# --- 7. the Mongo account ----------------------------------------------------
step '7. the inspector MongoDB user'
mongo_root() {
  docker compose exec -T mongodb mongosh --quiet \
    -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASS" --authenticationDatabase admin \
    "$MONGO_DB_NAME" --eval "$1"
}

if [ -f "$CONFIG_FILE" ] && grep -q '^MONGO_INSPECT_PASS=' "$CONFIG_FILE"; then
  # Keep the existing password rather than minting a new one, so a re-run does
  # not invalidate a config file that is already correct.
  MONGO_INSPECT_PASS="$(grep '^MONGO_INSPECT_PASS=' "$CONFIG_FILE" | cut -d= -f2-)"
  echo '   reusing the password already in the config file'
else
  MONGO_INSPECT_PASS="$(openssl rand -hex 24)"
  echo '   generated'
fi

# `role: read` on the application database and nothing else — no admin, no other
# database, no write of any kind. updateUser rather than createUser on a re-run.
if mongo_root "quit(db.getUser('inspector') ? 0 : 1)"; then
  mongo_root "db.updateUser('inspector', { pwd: '$MONGO_INSPECT_PASS', roles: [{ role: 'read', db: '$MONGO_DB_NAME' }] })" >/dev/null
  echo '   updated'
else
  mongo_root "db.createUser({ user: 'inspector', pwd: '$MONGO_INSPECT_PASS', roles: [{ role: 'read', db: '$MONGO_DB_NAME' }] })" >/dev/null
  echo '   created'
fi

# --- 8. wire the two together ------------------------------------------------
step '8. the config file'
# Readable by the script, writable only by root. These credentials are
# read-only, so the file leaking is not a breach — but it must not be editable
# by the account that reads it.
cat >"$CONFIG_FILE" <<CONFIG
# Read by /usr/local/bin/transacto-inspect. Read-only credentials only.
TRANSACTO_DIR=$PROJECT_DIR
MONGO_DB_NAME=$MONGO_DB_NAME
MONGO_INSPECT_USER=inspector
MONGO_INSPECT_PASS=$MONGO_INSPECT_PASS
REDIS_INSPECT_USER=inspector
REDIS_INSPECT_PASS=$REDIS_INSPECT_PASSWORD
CONFIG
chown root:"$ACCOUNT" "$CONFIG_FILE"
chmod 640 "$CONFIG_FILE"
echo "   $CONFIG_FILE, 640 root:$ACCOUNT"

# --- 9. prove it ------------------------------------------------------------
step '9. checks'
sudo -u "$ACCOUNT" SSH_ORIGINAL_COMMAND="v1 $(printf ps | base64)" /usr/local/bin/transacto-inspect >/dev/null &&
  echo '   ps: ok'
sudo -u "$ACCOUNT" SSH_ORIGINAL_COMMAND="v1 $(printf mongo | base64) $(printf collections | base64)" \
  /usr/local/bin/transacto-inspect >/dev/null && echo '   mongo collections: ok'
sudo -u "$ACCOUNT" SSH_ORIGINAL_COMMAND="v1 $(printf redis | base64) $(printf dbsize | base64)" \
  /usr/local/bin/transacto-inspect >/dev/null && echo '   redis dbsize: ok'

printf '\n== done. From your own machine:\n   ./deploy/inspect.sh ps\n   ssh -i ~/.ssh/transacto_inspect %s@HOST id   # must be refused\n' "$ACCOUNT"
