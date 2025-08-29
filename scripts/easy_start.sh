#!/usr/bin/env bash
set -e

printf "\n=== Easy Start & Diagnostics ===\n"

# Show env hints (do not modify .env here)
if [ -f "/app/frontend/.env" ]; then
  echo "Frontend .env present"
else
  echo "Frontend .env missing. Copy /app/frontend/.env.example to /app/frontend/.env and set REACT_APP_BACKEND_URL."
fi

if [ -f "/app/backend/.env" ]; then
  echo "Backend .env present"
else
  echo "Backend .env missing. Copy /app/backend/.env.example to /app/backend/.env and set MONGO_URL/DB_NAME and optional STUN/TURN."
fi

echo "\nHow to test now:"
echo "1) Open the frontend in your browser."
echo "2) Join a room (e.g., 'demo'), allow mic, open second device/tab and join same room."
echo "3) Speak to verify audio; send a chat message."

echo "\nNode package quickstart (external):"
echo "cd /app/node_webrtc_package && cp .env.example .env && cp public/config.example.js public/config.js && yarn install && PORT=3000 node server.js"
echo "Expose with: ngrok http --domain=hyena-close-purely.ngrok-free.app 3000"

printf "\nFor more details, see: /app/scripts/easy_start.md\n"