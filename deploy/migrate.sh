#!/usr/bin/env bash
#
# Runs a database migration on the server, from here.
#
#   ./deploy/migrate.sh status
#   ./deploy/migrate.sh up
#   ./deploy/migrate.sh down 0001-backfill-balance-entries
#   ./deploy/migrate.sh unlock
#
# It is a one-off container from the API image rather than a command inside the
# running one: the migration needs the database and nothing else, and a
# container that exits is easier to reason about than a process sharing a
# server's lifetime. `--rm` so nothing is left behind, `-T` because there is no
# terminal on the far end of an ssh command.
#
# Where it goes:
#   TRANSACTO_HOST   ssh target, e.g. root@openfunds.top  (required)
#   TRANSACTO_DIR    the compose project on that host     (default /var/www/monorepo-nx)
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <status|up|down [name]|unlock>" >&2
  exit 1
fi

host="${TRANSACTO_HOST:-}"
dir="${TRANSACTO_DIR:-/var/www/monorepo-nx}"

if [ -z "$host" ]; then
  echo "TRANSACTO_HOST is not set — e.g. TRANSACTO_HOST=root@openfunds.top $0 $*" >&2
  exit 1
fi

# Refuses an image older than the checkout, and this is not paranoia.
#
# Migrations ship *inside* `main.js`, so `migrate up` runs whatever the last
# `docker compose build` produced — not what is in git. A migration fixed in the
# repository and pulled but not rebuilt runs in its broken form, silently and
# with a convincing log. That happened: the first `0003` looped eleven thousand
# times, was fixed, pulled, and ran again exactly as before.
#
# Compared against the working tree's HEAD commit date rather than a build
# marker, because that is the thing a person just changed.
#
# Sent as a script of separate lines rather than one `&&` chain: the guard is
# several statements, and gluing them to the command with `&&` is a syntax
# error on the far end.
#
# `RemoteCommand=none` because a Host entry may carry one — `vlados` opens a
# login shell in /var/www — and ssh refuses to run a command beside it.
ssh -o RemoteCommand=none -o RequestTTY=no "$host" "
set -e
cd '$dir'

# The image the next \`compose run\` would use, by name — not the one the
# running container holds. That reference can be dangling after a rebuild, and
# \`compose images -q\` then errors instead of answering.
name=\$(docker compose config --images api 2>/dev/null | grep -- '-api\$' | head -1)
[ -n \"\$name\" ] || name=\$(basename \"\$PWD\")-api
created=\$(docker image inspect \"\$name\" --format '{{.Created}}' 2>/dev/null || true)

if [ -n \"\$created\" ]; then
  built=\$(date -d \"\$created\" +%s)
  committed=\$(git log -1 --format=%ct)

  if [ \"\$built\" -lt \"\$committed\" ]; then
    echo \"refusing: \$name was built before the current commit.\" >&2
    echo 'A migration runs from the image, not from the checkout. Run:' >&2
    echo '  docker compose build api' >&2
    exit 3
  fi
fi

docker compose run --rm -T api node main.js migrate $*
"
