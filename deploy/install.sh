#!/usr/bin/env bash
# One-line installer for an Overclock Arena server (Ubuntu 22.04 / 24.04):
#
#   curl -fsSL https://raw.githubusercontent.com/griefzz/stickgame/main/deploy/install.sh | sudo bash
#
# With options:
#   curl -fsSL .../install.sh | sudo DOMAIN=game.example.com REPO=you/your-fork bash
#
# It downloads the setup files from the newest build the repo has published (so you get the
# same tested files as the game itself) and runs setup-vps.sh. See setup-vps.sh for options.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root: ... | sudo bash" >&2; exit 1; }
REPO="${REPO:-griefzz/stickgame}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "REPO should look like owner/repo: $REPO" >&2; exit 1; }
command -v curl >/dev/null || { apt-get update -y && apt-get install -y curl; }

loc="$(curl -fsSI --max-time 20 "https://github.com/$REPO/releases/latest" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}' | tail -n 1)"
case "$loc" in
  */releases/tag/*) TAG="${loc##*/}" ;;
  *) echo "$REPO has no published builds yet. Its CI publishes one on every push to main." >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> fetching setup files from $REPO $TAG"
for f in deploy.tar.gz SHA256SUMS; do
  curl -fsSL --max-time 120 -o "$TMP/$f" "https://github.com/$REPO/releases/download/$TAG/$f"
done
(cd "$TMP" && grep '  deploy.tar.gz$' SHA256SUMS | sha256sum --quiet -c -) || { echo "checksum mismatch" >&2; exit 1; }
tar -xzf "$TMP/deploy.tar.gz" -C "$TMP"

REPO="$REPO" bash "$TMP/deploy/setup-vps.sh"
