#!/usr/bin/env bash
# One-time VPS setup for Overclock Arena (Ubuntu 22.04 / 24.04). Safe to re-run.
# Copy this repo's deploy/ folder to the VPS, then run as root:
#
#   sudo DOMAIN=game.example.com DEPLOY_PUBKEY="ssh-ed25519 AAAA... overclock-deploy" bash deploy/setup-vps.sh
#
# DOMAIN         your domain, or leave unset to answer on any host name / the bare IP
# DEPLOY_PUBKEY  public half of the key GitHub Actions uses to deploy (see README)
# BUN_VERSION    Bun to install (default matches CI)
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${DOMAIN:-_}"
BUN_VERSION="${BUN_VERSION:-1.3.14}"
APP=/opt/overclock
[[ "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "DOMAIN looks wrong: $DOMAIN" >&2; exit 1; }

echo "==> packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl unzip ca-certificates sudo

echo "==> bun $BUN_VERSION"
if ! /usr/local/bin/bun --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION"
fi
/usr/local/bin/bun --version

echo "==> users and folders"
id overclock >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin overclock
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -o deploy -g deploy -m 755 "$APP" "$APP/releases"
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  grep -qxF "$DEPLOY_PUBKEY" /home/deploy/.ssh/authorized_keys || echo "$DEPLOY_PUBKEY" >> /home/deploy/.ssh/authorized_keys
fi

echo "==> sudo rule: deploy may restart the game server and nothing else"
echo "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart overclock" > /etc/sudoers.d/overclock-deploy
chmod 440 /etc/sudoers.d/overclock-deploy
visudo -cf /etc/sudoers.d/overclock-deploy

echo "==> systemd service (started by the first deploy)"
install -m 644 "$HERE/overclock.service" /etc/systemd/system/overclock.service
systemctl daemon-reload
systemctl enable overclock

echo "==> nginx"
sed "s/server_name game.example.com;/server_name $DOMAIN;/" "$HERE/nginx.conf" > /etc/nginx/sites-available/overclock
ln -sfn /etc/nginx/sites-available/overclock /etc/nginx/sites-enabled/overclock
if [ "$DOMAIN" = "_" ] && [ -e /etc/nginx/sites-enabled/default ]; then
  echo "    no DOMAIN given: disabling nginx's default site so the game answers on the bare IP"
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> firewall: allowing HTTP/HTTPS"
  ufw allow 'Nginx Full'
fi

cat <<EOF

Done. Next:
  1. Add the GitHub secrets listed in the README (VPS_HOST, VPS_SSH_KEY, VPS_KNOWN_HOSTS).
  2. Push to main (or re-run the "CI / Deploy" workflow). The first deploy starts the server.
  3. HTTPS: sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN
EOF
