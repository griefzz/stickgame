#!/usr/bin/env bash
# overclock-update: installs the newest build published by the GitHub repo this server
# follows. overclock-update.timer runs it every couple of minutes as overclock-deploy.
#
#   overclock-update                 install the latest build if it's new (what the timer runs)
#   overclock-update --now           same, but even if AUTO_UPDATE=0 and without waiting for matches
#   overclock-update --tag build-41  install a specific published build (rollback / pinning)
#   overclock-update --from-dir DIR ID   install files from a local folder (testing)
#
# Run it by hand as:  sudo -u overclock-deploy overclock-update --now
# Settings come from /etc/overclock/update.conf (REPO, AUTO_UPDATE, MAX_DEFER_MINUTES).
set -euo pipefail

[ -r /etc/overclock/update.conf ] && . /etc/overclock/update.conf
REPO="${REPO:-griefzz/stickgame}"
AUTO_UPDATE="${AUTO_UPDATE:-1}"
MAX_DEFER_MINUTES="${MAX_DEFER_MINUTES:-30}"
APP="${APP_DIR:-/opt/overclock}"
PORT="${GAME_PORT:-8787}"
FILES=(index.html server.js activate.sh)

log() { echo "[overclock-update] $*"; }
die() { log "$*" >&2; exit 1; }

MODE=auto TAG="" SRC=""
case "${1:-}" in
  --now) MODE=now ;;
  --tag) MODE=now; TAG="${2:?--tag needs a release tag}" ;;
  --from-dir) MODE=local; SRC="${2:?--from-dir needs a folder}"; TAG="${3:?--from-dir needs an id}" ;;
  "") ;;
  *) die "unknown option: $1" ;;
esac

if [ "$MODE" = auto ] && [ "$AUTO_UPDATE" != 1 ]; then exit 0; fi
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "REPO should look like owner/repo, got: $REPO"

# One update at a time: timer runs skip if one is in progress, manual runs wait for it.
exec 9>"$APP/.update.lock"
if [ "$MODE" = auto ]; then flock -n 9 || exit 0
else flock -w 600 9 || die "another update has been running for 10 minutes"; fi

if [ -z "$TAG" ]; then
  # github.com/<repo>/releases/latest redirects to the newest release's tag page.
  loc="$(curl -fsSI --max-time 20 "https://github.com/$REPO/releases/latest" 2>/dev/null \
        | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}' | tail -n 1)" \
    || die "could not reach github.com/$REPO"
  case "$loc" in
    */releases/tag/*) TAG="${loc##*/}" ;;
    *) log "no published builds in $REPO yet"; exit 0 ;;
  esac
fi
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "odd release tag: $TAG"

CURRENT=none
[ -L "$APP/dist" ] && CURRENT="$(basename "$(readlink -f "$APP/dist")")"
if [ "$TAG" = "$CURRENT" ]; then
  [ "$MODE" = auto ] || log "already running $TAG"
  exit 0
fi

# Fetch and verify the release (once; a verified copy is reused on later runs).
REL="$APP/releases/$TAG"
if [ ! -f "$REL/.verified" ]; then
  TMP="$APP/releases/.incoming-$TAG"
  rm -rf "$TMP"
  mkdir -p "$TMP"
  if [ "$MODE" = local ]; then
    for f in "${FILES[@]}"; do cp "$SRC/$f" "$TMP/$f"; done
    if [ -f "$SRC/SHA256SUMS" ]; then cp "$SRC/SHA256SUMS" "$TMP/"; else (cd "$TMP" && sha256sum "${FILES[@]}" > SHA256SUMS); fi
  else
    log "downloading $TAG from $REPO"
    for f in "${FILES[@]}" SHA256SUMS; do
      curl -fsSL --max-time 120 -o "$TMP/$f" "https://github.com/$REPO/releases/download/$TAG/$f" \
        || { rm -rf "$TMP"; die "download failed: $f ($TAG)"; }
    done
  fi
  for f in "${FILES[@]}"; do grep -q "  $f\$" "$TMP/SHA256SUMS" || { rm -rf "$TMP"; die "$f missing from SHA256SUMS"; }; done
  (cd "$TMP" && sha256sum --quiet --ignore-missing -c SHA256SUMS) || { rm -rf "$TMP"; die "checksum mismatch in $TAG"; }
  touch "$TMP/.verified"
  rm -rf "$REL"
  mv "$TMP" "$REL"
fi

# A build that changes the server restarts it, which ends live matches. Unless asked to
# go now, wait for matches to finish (checked on each run) for up to MAX_DEFER_MINUTES.
if [ "$MODE" != now ] && [ -f "$APP/dist/server.js" ] && ! cmp -s "$APP/dist/server.js" "$REL/server.js"; then
  live="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -o '"matches":[0-9]*' | cut -d: -f2 || true)"
  if [ "${live:-0}" -gt 0 ]; then
    since="$APP/releases/.waiting-$TAG"
    [ -f "$since" ] || date +%s > "$since"
    waited=$(( ($(date +%s) - $(cat "$since")) / 60 ))
    if [ "$waited" -lt "$MAX_DEFER_MINUTES" ]; then
      log "$TAG restarts the server; waiting for $live live match(es) to end (${waited}/${MAX_DEFER_MINUTES} min)"
      exit 0
    fi
    log "waited ${MAX_DEFER_MINUTES} min for matches to end; updating anyway"
  fi
fi
rm -f "$APP"/releases/.waiting-*

log "installing $TAG (was $CURRENT)"
bash "$REL/activate.sh" "$TAG"
