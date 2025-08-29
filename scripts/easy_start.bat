@echo off
setlocal enableextensions enabledelayedexpansion

echo === Easy Start (Windows) ===

if exist "..\frontend\.env" (
  echo Frontend .env present
) else (
  echo Frontend .env missing. Copy ..\frontend\.env.example to ..\frontend\.env and set REACT_APP_BACKEND_URL.
)

if exist "..\backend\.env" (
  echo Backend .env present
) else (
  echo Backend .env missing. Copy ..\backend\.env.example to ..\backend\.env and set MONGO_URL/DB_NAME and optional STUN/TURN.
)

echo.
echo Node package quickstart:
echo   cd ..\node_webrtc_package
echo   copy .env.example .env
echo   copy public\config.example.js public\config.js
echo   yarn install
echo   set PORT=3000 && node server.js

echo Expose with ngrok on your machine:
echo   ngrok http --domain=hyena-close-purely.ngrok-free.app 3000

echo.
echo For details, open ..\scripts\easy_start.md

endlocal