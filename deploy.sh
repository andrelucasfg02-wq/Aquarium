#!/usr/bin/env bash
# Deploy the portable aquarium game to an Ubuntu 24.04 VM (e.g. Oracle Cloud free tier).
# Run as a user with sudo on the VM, from the project directory.
set -euo pipefail

echo "==> Installing Docker (if needed)..."
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

echo "==> Opening firewall port 3000..."
if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port=3000/tcp || true
  sudo firewall-cmd --reload || true
elif command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 3000/tcp || true
fi
echo "NOTE (Oracle Cloud): also add an Ingress Rule for TCP port 3000 (0.0.0.0/0) in the subnet's Security List via the cloud console."

echo "==> Building and starting the app..."
sudo docker compose up -d --build

echo "==> Done! The game should be reachable at http://<this-VM-public-IP>:3000"
echo "    Optional: put Caddy in front for a domain + HTTPS:"
echo "      sudo apt-get install -y caddy"
echo "      # Caddyfile: yourdomain.com { reverse_proxy 127.0.0.1:3000 }"
echo "      sudo systemctl reload caddy"
