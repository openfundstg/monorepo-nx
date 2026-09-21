#!/usr/bin/env bash
#
# One home for the rule that ssh to the origin goes through Tor.
#
# The origin is hidden: DNS for openfunds.top points at the public worker VPS,
# which L4-forwards raw TLS to this host's `web` onion, and Caddy listens only
# on loopback (see deploy/Caddyfile). Its public `:22` is closed too — a direct
# `ssh` to the machine's address does not connect, and the address itself is the
# thing the arrangement exists to keep off the wire.
#
# So both scripts that reach the server — `inspect.sh` and `migrate.sh` — go to
# an `.onion` through the local Tor daemon. This file is what makes that a rule
# rather than a habit: it resolves whatever host was configured through ssh's
# own config and **refuses** anything that is not an onion, instead of quietly
# opening a clearnet connection that names the origin to every hop on the way.
#
# Sourced, not executed.

# Prints the ssh options the caller should add, one per line; refuses with a
# non-zero status and a message on stderr if the route would not be over Tor.
tor_route_options() {
  local host="$1"
  local config resolved proxy socks

  # ssh's own resolution, so a `Host` alias in ~/.ssh/config is honoured: the
  # useful form here is an alias whose HostName is the onion, and reading it
  # any other way would mean reimplementing ssh_config.
  config="$(ssh -G "$host" 2>/dev/null || true)"
  resolved="$(printf '%s\n' "$config" | awk '$1 == "hostname" { print $2; exit }')"
  [ -n "$resolved" ] || resolved="${host##*@}"

  case "$resolved" in
    *.onion) ;;
    *)
      cat >&2 <<REFUSED
refusing: $host resolves to $resolved, which is not an onion.

The origin is hidden — its public :22 is closed and its address is not meant to
appear on the wire. Point the host at the server's ssh onion instead, either
directly (inspector@<hash>.onion) or through a Host alias in ~/.ssh/config whose
HostName is that onion.

deploy/inspect/README.md has the setup.
REFUSED
      return 1
      ;;
  esac

  # A ProxyCommand already in ssh_config wins — a `Host *.onion` block is the
  # usual way this is set up, and overriding it here would ignore a deliberate
  # choice of SOCKS port or proxy tool.
  proxy="$(printf '%s\n' "$config" | awk '$1 == "proxycommand" { $1 = ""; sub(/^ /, ""); print; exit }')"

  if [ -z "$proxy" ] || [ "$proxy" = "none" ]; then
    socks="${TRANSACTO_TOR_SOCKS:-127.0.0.1:9050}"

    if ! command -v nc >/dev/null 2>&1; then
      cat >&2 <<MISSING
refusing: $resolved needs a Tor route and there is no \`nc\` to build one.

Either install netcat-openbsd, or put the route in ~/.ssh/config yourself:

  Host *.onion
      ProxyCommand nc -X 5 -x $socks %h %p
MISSING
      return 1
    fi

    # SOCKS5 with the name resolved at the proxy (`-X 5 -x`), so the onion is
    # never handed to a local resolver — which cannot answer it anyway, and
    # would leak the lookup trying.
    printf '%s\n' '-o' "ProxyCommand=nc -X 5 -x $socks %h %p"
  fi
}

# Reads the options into the named array, or exits. Bash only — both callers are.
tor_route_into() {
  local -n _out="$1"
  local text

  text="$(tor_route_options "$2")" || exit 2

  _out=()
  [ -n "$text" ] && mapfile -t _out <<<"$text"

  return 0
}
