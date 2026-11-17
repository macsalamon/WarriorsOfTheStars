@echo off
rem Warriors of the Stars: starts the game with a tunnel to the internet, so that a player anywhere can join with a link.
rem It needs the free program cloudflared (Cloudflare); if it is missing, it is installed with winget (Windows 10 and 11).
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
set "WOTS_INTERNET=1"
call "%~dp0start.bat"
