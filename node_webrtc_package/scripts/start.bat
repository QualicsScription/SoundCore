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

set "NGROK_EXE=ngrok"
if exist ".\ngrok.exe" set "NGROK_EXE=.\ngrok.exe"

where %NGROK_EXE% >nul 2>&1
if %errorlevel%==0 (
  set "DISABLE_AUTO_NGROK=1"
  if not "%NGROK_AUTHTOKEN%"=="" (
    %NGROK_EXE% config add-authtoken %NGROK_AUTHTOKEN%
  )
  start "ngrok" cmd /c %NGROK_EXE% http --domain=%NGROK_DOMAIN% %PORT%
  node server.js
) else (
  echo ngrok CLI bulunamadi. Tünel baslatilmadi; sunucu localde calisiyor: http://0.0.0.0:%PORT%
  node server.js
)

endlocal