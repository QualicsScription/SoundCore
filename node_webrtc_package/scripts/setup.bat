@echo off
setlocal enableextensions enabledelayedexpansion
cd /d %~dp0\..

if not exist .env (
  copy .env.example .env >nul
)
if not exist public\config.js (
  copy public\config.example.js public\config.js >nul
)

set NG_TOKEN=31qEJSY9ua32G2qjnl4bSM14D6j_7fPSAQTytjPmX2Je9mvBY
set NG_DOMAIN=hyena-close-purely.ngrok-free.app

rem Write/replace NGROK_AUTHTOKEN and NGROK_DOMAIN in .env
powershell -Command "$env=Get-Content '.env';$env=$env -replace '^NGROK_AUTHTOKEN=.*','NGROK_AUTHTOKEN=%NG_TOKEN%';$env=$env -replace '^NGROK_DOMAIN=.*','NGROK_DOMAIN=%NG_DOMAIN%';Set-Content '.env' $env"

rem Ensure lines exist if they were not present
findstr /i "^NGROK_AUTHTOKEN=" .env >nul || echo NGROK_AUTHTOKEN=%NG_TOKEN%>>.env
findstr /i "^NGROK_DOMAIN=" .env >nul || echo NGROK_DOMAIN=%NG_DOMAIN%>>.env

where yarn >nul 2>&1
if errorlevel 1 (
  echo Please install Yarn (https://yarnpkg.com/) and re-run.
  exit /b 1
)

yarn install

echo Setup complete. You can now run scripts\start.bat
endlocal