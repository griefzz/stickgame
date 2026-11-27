#!/usr/bin/env bash
# Sets up an Overclock Arena server on Ubuntu 22.04 / 24.04 that keeps itself up to date
# from the builds a GitHub repo publishes. Safe to re-run; that's also how you refresh it.
#
# Usually run through the one-line installer:
#   curl -fsSL https://raw.githubusercontent.com/griefzz/stickgame/main/deploy/install.sh | sudo bash
# or from a clone:
#   sudo bash deploy/setup-vps.sh
#
# Options (environment variables):
#   DOMAIN=game.example.com  serve on this name (default: any name, including the bare IP)
#   REPO=owner/repo          where builds come from (default: keep the current setting, else this
#                            clone's GitHub origin, else griefzz/stickgame)
#   AUTO_UPDATE=0            install the current build but don't keep checking for new ones
#   SKIP_FIRST_UPDATE=1      don't install a build now (CI uses this)
#   BUN_VERSION=1.3.14       Bun to install
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${DOMAIN:-_}"
BUN_VERSION="${BUN_VERSION:-1.3.14}"
APP=/opt/overclock
CONF=/etc/overclock
[[ "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "DOMAIN looks wrong: $DOMAIN" >&2; exit 1; }

# Which repo to follow: explicit > already configured > this clone's origin > upstream.
if [ -z "${REPO:-}" ] && [ -r "$CONF/update.conf" ]; then REPO="$(. "$CONF/update.conf"; echo "${REPO:-}")"; fi
if [ -z "${REPO:-}" ] && command -v git >/dev/null; then
  origin="$(git -C "$HERE/.." remote get-url origin 2>/dev/null || true)"
  [[ "$origin" =~ github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+) ]] && REPO="${BASH_REMATCH[1]%.git}"
fi
REPO="${REPO:-griefzz/stickgame}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "REPO should look like owner/repo: $REPO" >&2; exit 1; }
if [ -z "${AUTO_UPDATE:-}" ] && [ -r "$CONF/update.conf" ]; then AUTO_UPDATE="$(. "$CONF/update.conf"; echo "${AUTO_UPDATE:-1}")"; fi
AUTO_UPDATE="${AUTO_UPDATE:-1}"

echo "==> packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl unzip ca-certificates sudo

echo "==> bun $BUN_VERSION"
if ! /usr/local/bin/bun --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION"
fi
/usr/local/bin/bun --version

echo "==> users and folders"
# overclock runs the game; overclock-deploy installs builds (and may restart the game, nothing else).
id overclock >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin overclock
id overclock-deploy >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin overclock-deploy
install -d -o overclock-deploy -g overclock-deploy -m 755 "$APP" "$APP/releases"
install -d -m 755 "$CONF"
install -m 755 "$HERE/update.sh" /usr/local/bin/overclock-update
echo "overclock-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart overclock" > /etc/sudoers.d/overclock-deploy
chmod 440 /etc/sudoers.d/overclock-deploy
visudo -cf /etc/sudoers.d/overclock-deploy

echo "==> settings in $CONF"
cat > "$CONF/update.conf" <<EOF
# Where this server gets game builds from: a GitHub repo whose CI publishes releases.
# Point it only at a repo you trust; the server runs what that repo publishes.
REPO=$REPO
# 1 = check every couple of minutes and install new builds; 0 = only when you run overclock-update --now
AUTO_UPDATE=$AUTO_UPDATE
# Builds that restart the server wait this long for live matches to finish.
MAX_DEFER_MINUTES=${MAX_DEFER_MINUTES:-30}
EOF
if [ ! -f "$CONF/overclock.env" ]; then
  cat > "$CONF/overclock.env" <<'EOF'
# Overclock Arena server settings. After editing: sudo systemctl restart overclock
# Seats per match (2-4); a lobby launches as soon as this many players queue.
MATCH_SIZE=4
# Fewest humans a queue match starts with, and how long (seconds) to wait for more.
MIN_PLAYERS=2
FILL_WAIT=12
# Arenas queue and practice matches pick from at random (rooms pick their own).
#ARENAS=box,octagon,circle,star,plus
# Bots may fill empty seats up to this many (if every player in the lobby allows it). 0 = never.
# Defaults to MATCH_SIZE.
#BOT_FILL_TO=4
MAX_CONNS=400
EOF
fi

echo "==> systemd"
install -m 644 "$HERE/overclock.service" "$HERE/overclock-update.service" "$HERE/overclock-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable overclock
# The timer starts after the first install below, so the two never race.
if [ "$AUTO_UPDATE" = 1 ]; then systemctl enable overclock-update.timer; else systemctl disable --now overclock-update.timer 2>/dev/null || true; fi

echo "==> nginx"
sed "s/server_name game.example.com;/server_name $DOMAIN;/" "$HERE/nginx.conf" > /etc/nginx/sites-available/overclock
ln -sfn /etc/nginx/sites-available/overclock /etc/nginx/sites-enabled/overclock
if [ "$DOMAIN" = "_" ] && [ -e /etc/nginx/sites-enabled/default ]; then
  echo "    no DOMAIN given: disabling nginx's default site so the game answers on the bare IP"
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl enable nginx
systemctl reload-or-restart nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> firewall: allowing HTTP/HTTPS"
  ufw allow 'Nginx Full'
fi

if [ "${SKIP_FIRST_UPDATE:-0}" != 1 ]; then
  echo "==> installing the newest build from $REPO"
  sudo -u overclock-deploy /usr/local/bin/overclock-update --now
fi
if [ "$AUTO_UPDATE" = 1 ]; then
  systemctl start overclock-update.timer
fi

where="$([ "$DOMAIN" = "_" ] && echo "http://<this server's IP>/" || echo "http://$DOMAIN/")"
cat <<EOF

Overclock Arena is set up, following $REPO.
  Play:      $where
  Updates:   $([ "$AUTO_UPDATE" = 1 ] && echo "automatic (checks every 2 minutes)" || echo "manual: sudo -u overclock-deploy overclock-update --now")
  Settings:  $CONF/overclock.env, then sudo systemctl restart overclock
  HTTPS:     sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d <your domain>
EOF
