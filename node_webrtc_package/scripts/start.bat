@echo off
setlocal enableextensions enabledelayedexpansion
cd /d %~dp0\..

rem Read .env values
set PORT=3000
set NGROK_AUTHTOKEN=
set NGROK_DOMAIN=hyena-close-purely.ngrok-free.app
for /f "usebackq tokens=1* delims==" %%A in (".env") do (
  if /i "%%A"=="PORT" set PORT=%%B
  if /i "%%A"=="NGROK_AUTHTOKEN" set NGROK_AUTHTOKEN=%%B
  if /i "%%A"=="NGROK_DOMAIN" set NGROK_DOMAIN=%%B
)

where ngrok >nul 2>&1
if %errorlevel%==0 (
  set DISABLE_AUTO_NGROK=1
  if not "%NGROK_AUTHTOKEN%"=="" (
    ngrok config add-authtoken %NGROK_AUTHTOKEN%
  )
  start "ngrok" cmd /c ngrok http --domain=%NGROK_DOMAIN% %PORT%
  node server.js
) else (
  echo ngrok CLI not found. Falling back to auto-ngrok inside server.js
  node server.js
)

endlocal