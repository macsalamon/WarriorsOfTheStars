@echo off
rem Warriors of the Stars: starts the game and opens it in your browser.
rem It needs Node.js 20 or newer. It uses, in this order: the copy in the "node" folder next to this file (the download with Node included has one),
rem the Node.js installed on this computer, or it downloads the official Node.js into the "node" folder (about 30 MB, once; nothing is installed on your computer).
setlocal enableextensions
cd /d "%~dp0"
title Warriors of the Stars
if not defined PORT set "PORT=8787"
set "NODE_VERSION=@NODE_VERSION@"
set "NODE_EXE="
set "NODEMAJOR="
rem PowerShell by its full name: it is always in this place on Windows 10 and 11, whatever the PATH says
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

if exist "node\node.exe" goto :usebundled

where node >nul 2>nul
if errorlevel 1 goto :download
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODEMAJOR=%%v"
if not defined NODEMAJOR goto :download
if %NODEMAJOR% LSS 20 goto :download
for /f "delims=" %%p in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%p"
if defined NODE_EXE goto :havenode
goto :download

:usebundled
set "NODE_EXE=%CD%\node\node.exe"
goto :havenode

:download
echo.
echo Node.js 20 or newer is needed to run the game, and it isn't on this computer.
echo It will be downloaded now from nodejs.org into the "node" folder here ^(about 30 MB^).
echo.
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-node.ps1" -Version %NODE_VERSION% -Arch %ARCH%
if errorlevel 1 goto :nodefail
if not exist "node\node.exe" goto :nodefail
set "NODE_EXE=%CD%\node\node.exe"

:havenode
if not exist "server.cjs" goto :nofiles

echo.
echo Starting Warriors of the Stars on port %PORT% ...
echo Close this window to stop the game.
echo.

rem opens the browser as soon as the server answers (set WOTS_NO_BROWSER=1 to skip it); it asks 127.0.0.1, not localhost: Windows PowerShell 5 may try the IPv6 address first and wait for it
if defined WOTS_NO_BROWSER goto :run
start "" /b "%PS%" -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/net-info' -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:%PORT%'; break } catch { Start-Sleep -Milliseconds 500 } }"

:run
if defined WOTS_INTERNET goto :runnet
"%NODE_EXE%" server.cjs --port %PORT%
if errorlevel 1 goto :fail
goto :eof

:runnet
echo The link for the other player appears below ^(Over the internet^), and on the host screen of the game.
"%NODE_EXE%" server.cjs --port %PORT% --internet
if errorlevel 1 goto :fail
goto :eof

:nofiles
echo server.cjs is missing: the game wasn't unpacked completely. Unpack the whole zip file, then start again.
goto :fail

:nodefail
echo.
echo Node.js could not be downloaded. Check the internet connection and start again, or install Node.js 20 or newer from https://nodejs.org and start again.

:fail
echo.
pause
exit /b 1
