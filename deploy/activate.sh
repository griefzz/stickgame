#!/usr/bin/env bash
# Runs on the VPS (as the deploy user) once a release has been uploaded to
# /opt/overclock/releases/<id>/. It:
#   1. points /opt/overclock/dist at the new release (an atomic symlink swap),
#   2. restarts the game server only if server.js changed, so client-only updates
#      don't interrupt matches (idle players reload into the new page by themselves),
#   3. health-checks the server and rolls back to the previous release if it fails,
#   4. keeps the five newest releases.
# Usage: activate.sh <release-id>
set -euo pipefail

ID="${1:?usage: activate.sh <release-id>}"
APP="${APP_DIR:-/opt/overclock}"
PORT="${GAME_PORT:-8787}"
REL="$APP/releases/$ID"

[ -f "$REL/index.html" ] && [ -f "$REL/server.js" ] || { echo "release $REL is incomplete" >&2; exit 1; }
chmod 755 "$REL"
chmod 644 "$REL/index.html" "$REL/server.js"

PREV="$(readlink -f "$APP/dist" 2>/dev/null || true)"
[ "$PREV" = "$REL" ] && PREV=""

switch_to() { ln -sfn "$1" "$APP/dist.next" && mv -Tf "$APP/dist.next" "$APP/dist"; }
healthy() {
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

restart=1
if [ -n "$PREV" ] && [ -f "$PREV/server.js" ] && cmp -s "$PREV/server.js" "$REL/server.js" \
   && systemctl is-active --quiet overclock; then
  restart=0
fi

switch_to "$REL"
if [ "$restart" = 1 ]; then
  echo "server.js changed: restarting overclock"
  sudo -n /usr/bin/systemctl restart overclock
else
  echo "client-only update: no restart, live matches keep running"
fi

if ! healthy; then
  echo "health check failed" >&2
  if [ -n "$PREV" ]; then
    echo "rolling back to $PREV" >&2
    switch_to "$PREV"
    sudo -n /usr/bin/systemctl restart overclock || true
  fi
  exit 1
fi
echo "live: $ID $(curl -fsS "http://127.0.0.1:$PORT/health")"

# Keep the five newest releases (the live one is always the newest).
cd "$APP/releases"
ls -1t | tail -n +6 | while read -r old; do
  [ "$APP/releases/$old" != "$REL" ] && rm -rf -- "$APP/releases/$old"
done
