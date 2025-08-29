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
echo Starting Node.js signaling server with ngrok on your domain...

if exist "..\node_webrtc_package" (
  pushd "..\node_webrtc_package"
  if not exist ".env" (
    copy .env.example .env >nul
  )
  if not exist "public\config.js" (
    copy public\config.example.js public\config.js >nul
  )
  call scripts\setup.bat
  call scripts\start.bat
  popd
) else (
  echo ERROR: ..\node_webrtc_package folder not found.
)

echo.
echo For details, open ..\scripts\easy_start.md

endlocal