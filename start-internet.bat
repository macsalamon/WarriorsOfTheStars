@echo off
rem Warriors of the Stars (development copy): builds the current code and hosts it with a tunnel to the internet.
rem The link for the other player is shown below, on the host screen and in the main menu of the game.
rem It needs the free program cloudflared (Cloudflare); if it is missing, it is installed with winget.
setlocal enableextensions
cd /d "%~dp0"
set "CF="
where cloudflared >nul 2>nul && set "CF=1"
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=1"
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=1"
if not defined CF (
  echo.
  echo The tunnel needs the free program cloudflared, which is not installed yet.
  echo It will be installed now with winget ^(from Cloudflare, about 20 MB^).
  echo.
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo It could not be installed. Install cloudflared from https://github.com/cloudflare/cloudflared/releases and start this again.
    pause
    exit /b 1
  )
)
if not exist node_modules (
  echo Installing the packages ^(first start only^)...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm run host:internet
if errorlevel 1 pause
