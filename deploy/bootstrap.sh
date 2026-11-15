#!/usr/bin/env bash
# One-time VM setup (Debian 12). Run as root on the VM:  sudo bash bootstrap.sh <hostname>
set -euo pipefail
HOST="${1:?usage: bootstrap.sh <public hostname>}"

# 1 GB swap so npm install never OOMs on an e2-micro
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22 (node:sqlite needs >= 22.13)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (automatic HTTPS)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

id claimit >/dev/null 2>&1 || useradd --system --home /opt/claimit --shell /usr/sbin/nologin claimit
mkdir -p /opt/claimit /var/lib/claimit
chown -R claimit:claimit /opt/claimit /var/lib/claimit

cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy || systemctl restart caddy
node -v
