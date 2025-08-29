#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Copy env and config if missing
if [ ! -f .env ]; then
  cp .env.example .env
fi
if [ ! -f public/config.js ]; then
  cp public/config.example.js public/config.js
fi

# Inject provided ngrok credentials
# You can change these by editing .env later
NG_TOKEN="31qEJSY9ua32G2qjnl4bSM14D6j_7fPSAQTytjPmX2Je9mvBY"
NG_DOMAIN="hyena-close-purely.ngrok-free.app"

if grep -q "^NGROK_AUTHTOKEN=" .env; then
  sed -i.bak "s#^NGROK_AUTHTOKEN=.*#NGROK_AUTHTOKEN=${NG_TOKEN}#" .env || true
else
  echo "NGROK_AUTHTOKEN=${NG_TOKEN}" >> .env
fi
if grep -q "^NGROK_DOMAIN=" .env; then
  sed -i.bak "s#^NGROK_DOMAIN=.*#NGROK_DOMAIN=${NG_DOMAIN}#" .env || true
else
  echo "NGROK_DOMAIN=${NG_DOMAIN}" >> .env
fi

# Install deps
if command -v yarn >/dev/null 2>&1; then
  yarn install
else
  echo "Please install yarn (https://yarnpkg.com/) and re-run."
  exit 1
fi

echo "Setup complete. Edit .env to change defaults if needed."