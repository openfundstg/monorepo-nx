# A current base with the distro's own tor, rather than one of the tor images
# on Docker Hub — most are unmaintained, and this one is a network client with
# a config file, which is not enough to be worth inheriting somebody's 2019
# Debian for.
FROM alpine:3.22

RUN apk add --no-cache tor \
    # Tor refuses a group- or world-readable state directory and repairs it on
    # start, with a warning every time. Doing it here keeps that line out of
    # the log, where a real warning has to be findable.
 && chmod 700 /var/lib/tor

COPY deploy/tor/torrc /etc/tor/torrc

# The package's own unprivileged user, which also owns /var/lib/tor.
USER tor

EXPOSE 9080

ENTRYPOINT ["tor", "-f", "/etc/tor/torrc"]
