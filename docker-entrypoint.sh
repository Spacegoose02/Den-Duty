#!/bin/sh
# Runs the server as PUID:PGID (Unraid uses 99:100) and makes sure it can write to /data.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  # Only fix ownership when it's wrong, so big data folders aren't re-chowned on every start.
  if [ "$(stat -c %u /data)" != "$PUID" ] || [ "$(stat -c %g /data)" != "$PGID" ]; then
    echo "Setting /data owner to $PUID:$PGID"
    chown -R "$PUID:$PGID" /data
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
