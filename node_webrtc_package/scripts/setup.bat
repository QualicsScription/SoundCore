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

rem PowerShell ile var olan satirlari guncelle
powershell -Command "$env=Get-Content '.env';$env=$env -replace '^NGROK_AUTHTOKEN=.*','NGROK_AUTHTOKEN=%NG_TOKEN%';$env=$env -replace '^NGROK_DOMAIN=.*','NGROK_DOMAIN=%NG_DOMAIN%';Set-Content '.env' $env"

rem Yoksa ekle
findstr /i "^NGROK_AUTHTOKEN=" .env >nul || echo NGROK_AUTHTOKEN=%NG_TOKEN%>>.env
findstr /i "^NGROK_DOMAIN=" .env >nul || echo NGROK_DOMAIN=%NG_DOMAIN%>>.env

where yarn >nul 2>&1
if errorlevel 1 (
  echo Yarn bulunamadi. Yukleyin: https://yarnpkg.com/ ve tekrar calistirin.
  exit /b 1
)

yarn install

echo Setup tamamlandi.
endlocal