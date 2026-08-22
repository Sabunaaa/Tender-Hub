#!/usr/bin/env bash
# Provision Tender Hub on a fresh Ubuntu 24.04 server, x86 or ARM. Tested against
# Google Cloud and Oracle Cloud images; safe to re-run after pulling new code.
#
#   git clone <repo> ~/tender-hub && ~/tender-hub/deploy/setup.sh
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-$USER}"
PORT="${TENDER_PORT:-80}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
sudo -E apt-get update -qq
sudo -E apt-get install -y python3-venv python3-pip curl iptables-persistent

# Vite needs a newer Node than Ubuntu ships in its archive.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo -E apt-get install -y nodejs
fi

# Small instances such as GCP's e2-micro have 1 GB of RAM, which is not enough for
# the Vite build or for extracting text from large PDFs; both die on an OOM kill.
# Larger machines skip this.
TOTAL_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [ "$TOTAL_MB" -lt 2048 ] && ! sudo swapon --show | grep -q /swapfile; then
  echo "==> Only ${TOTAL_MB}MB RAM, adding a 2G swap file"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap -q /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Installing Python dependencies"
[ -d "$APP_DIR/.venv" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/backend/requirements.txt"

echo "==> Building the frontend"
npm --prefix "$APP_DIR/frontend" ci
npm --prefix "$APP_DIR/frontend" run build

# Oracle's Ubuntu images ship a REJECT rule in INPUT, so the cloud firewall alone
# is not enough there. On GCP this rule is simply redundant.
if ! sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
  echo "==> Opening port $PORT in the local firewall"
  sudo iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
  sudo netfilter-persistent save
fi

echo "==> Installing the systemd service"
sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@USER@|$SERVICE_USER|g" \
    -e "s|@PORT@|$PORT|g" \
    "$APP_DIR/deploy/tenderhub.service" >/tmp/tenderhub.service
sudo mv /tmp/tenderhub.service /etc/systemd/system/tenderhub.service
sudo systemctl daemon-reload
sudo systemctl enable --now tenderhub
sudo systemctl restart tenderhub

echo
echo "Done. Service status:"
sudo systemctl --no-pager --lines=5 status tenderhub || true
echo
echo "Open http://$(curl -fsS --max-time 5 ifconfig.me || echo '<server-ip>')/"
