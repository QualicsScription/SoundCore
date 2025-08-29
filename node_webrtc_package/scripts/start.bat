@echo off
setlocal enableextensions enabledelayedexpansion
cd /d %~dp0\..

rem Varsayilanlar
set "PORT=3000"
set "NGROK_AUTHTOKEN="
set "NGROK_DOMAIN=hyena-close-purely.ngrok-free.app"

rem .env oku (yorum ve bos satirlari atla)
setlocal enabledelayedexpansion
if exist ".env" (
  for /f "usebackq tokens=1* delims==" %%A in (".env") do (
    set "key=%%~A"
    set "val=%%~B"
    if defined key (
      if not "!key:~0,1!"=="#" (
        if /i "!key!"=="PORT" set "PORT=!val!"
        if /i "!key!"=="NGROK_AUTHTOKEN" set "NGROK_AUTHTOKEN=!val!"
        if /i "!key!"=="NGROK_DOMAIN" set "NGROK_DOMAIN=!val!"
      )
    )
  )
)
endlocal & set "PORT=%PORT%" & set "NGROK_AUTHTOKEN=%NGROK_AUTHTOKEN%" & set "NGROK_DOMAIN=%NGROK_DOMAIN%"

where ngrok >nul 2>&1
if %errorlevel%==0 (
  set "DISABLE_AUTO_NGROK=1"
  if not "%NGROK_AUTHTOKEN%"=="" (
    ngrok config add-authtoken %NGROK_AUTHTOKEN%
  )
  start "ngrok" cmd /c ngrok http --domain=%NGROK_DOMAIN% %PORT%
  node server.js
) else (
  echo ngrok CLI bulunamadi. server.js icindeki auto-ngrok kullanilacak.
  node server.js
)

endlocal