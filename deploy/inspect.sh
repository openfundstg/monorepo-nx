#!/usr/bin/env bash
#
# Read-only look at production, from here.
#
#   ./deploy/inspect.sh ps
#   ./deploy/inspect.sh logs api --since 30m --grep 'FRAUD|NovaPay'
#   ./deploy/inspect.sh mongo find tma_sales '{"publicId":"8GJPNPDY"}'
#   ./deploy/inspect.sh redis get 'terminal:baseline:28304'
#   ./deploy/inspect.sh help
#
# This script decides nothing. The server does: the key it uses is pinned to
# `/usr/local/bin/transacto-inspect` by a forced command, so whatever is typed
# here reaches that allowlist and nothing else. Editing this file cannot widen
# what is reachable — which is the property that makes it safe to hand to an
# agent. Setting it up: deploy/inspect/README.md.
#
# Configuration, from deploy/inspect.env (gitignored) or the environment:
#   TRANSACTO_INSPECT_HOST   ssh target, e.g. inspector@openfunds.top  (required)
#   TRANSACTO_INSPECT_KEY    private key for that account             (required)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A file rather than exported variables, because the usual caller is an agent
# whose shell does not survive between commands: an `export` two calls ago is
# gone, and a config file is not.
if [ -f "$here/inspect.env" ]; then
  set -a && . "$here/inspect.env" && set +a
fi

host="${TRANSACTO_INSPECT_HOST:-}"
key="${TRANSACTO_INSPECT_KEY:-}"

if [ -z "$host" ] || [ -z "$key" ]; then
  cat >&2 <<'SETUP'
inspect.sh is not configured yet.

Copy deploy/inspect.env.example to deploy/inspect.env and fill in the two
values, or export TRANSACTO_INSPECT_HOST and TRANSACTO_INSPECT_KEY.

The server side has to exist first — deploy/inspect/README.md is the checklist.
SETUP
  exit 2
fi

[ -r "$key" ] || { echo "inspect.sh: cannot read the key at $key" >&2; exit 2; }

# Each argument base64-encoded, so quoting stops being a problem the moment it
# leaves this line. A Mongo filter is full of braces, quotes and dollar signs,
# and every one of them is an opaque token by the time ssh sees it.
encoded='v1'
for argument in "$@"; do
  encoded="$encoded $(printf '%s' "$argument" | base64 | tr -d '\n')"
done

# `-T` because the far end has no terminal and never needs one; IdentitiesOnly
# so a loaded agent key is not offered ahead of the inspector's own.
exec ssh -T \
  -i "$key" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  "$host" "$encoded"
