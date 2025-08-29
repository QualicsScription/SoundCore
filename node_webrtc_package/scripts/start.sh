#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi
: "${PORT:=3000}"
: "${NGROK_AUTHTOKEN:=}"
: "${NGROK_DOMAIN:=hyena-close-purely.ngrok-free.app}"

# If ngrok CLI is available, use it and disable auto-ngrok in server.js
if command -v ngrok >/dev/null 2>&1; then
  export DISABLE_AUTO_NGROK=1
  if [ -n "$NGROK_AUTHTOKEN" ]; then
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" || true
  fi
  # Start ngrok in background
  ngrok http --domain="$NGROK_DOMAIN" "$PORT" &
  NGROK_PID=$!
  echo "Started ngrok (pid $NGROK_PID)"
  # Start server in foreground
  node server.js
  # Cleanup ngrok on exit
  kill $NGROK_PID || true
else
  echo "ngrok CLI not found. Falling back to auto-ngrok inside server.js"
  node server.js
fi