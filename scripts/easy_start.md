# Easy Start & Keys Guide

This guide shows how to run and test both deliverables and where to place any keys.

## A) FastAPI + React (runs here)
- Backend WS endpoint: /api/ws
- Frontend uses REACT_APP_BACKEND_URL (already set in frontend/.env)

Quick steps:
1) Join any room name (e.g., "demo"), allow microphone.
2) Open another browser/device and join the same room.
3) Speak to verify audio, VU meters, chat.

Troubleshooting:
- If join fails, ensure mic permission is granted.
- If peers don't connect across networks, you likely need a TURN server. The FastAPI client currently uses public STUN only.

## B) Node.js + Socket.IO package (run externally)
Folder: /app/node_webrtc_package

1) Create env & config
   cp .env.example .env
   cp public/config.example.js public/config.js
   # Edit .env CORS_ORIGINS if needed, and config.js for SIGNAL_URL/ICE

2) Install & run
   yarn install
   yarn start
   # Or: PORT=3000 HOST=0.0.0.0 node server.js

3) Expose via ngrok (on your machine):
   ngrok http --domain=hyena-close-purely.ngrok-free.app 3000

4) Open https://hyena-close-purely.ngrok-free.app/

Optional ICE/TURN keys:
- Put TURN creds into public/config.js via window.__ICE.
- If using a vendor (e.g., Twilio, Xirsys), paste their TURN urls/username/credential.

## C) Where to insert API keys
- FastAPI+React (here): Not required for MVP. If you later add TURN, expose config via an /api/ice endpoint or a public JSON and read it in the client.
- Node package: Use public/config.js for TURN credentials (client-side) and .env for server CORS/signaling origin.

## D) Testing
- Backend signaling tested: pass (see /app/test_result.md)
- Ask to run Automated Frontend Testing when ready (we can execute now upon request).