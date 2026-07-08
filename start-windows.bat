@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Workflow System.
  echo Install Node.js 20 or newer from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)

if "%HOST%"=="" set HOST=0.0.0.0
if "%PORT%"=="" set PORT=3000
if "%ACCESS_PIN%"=="" set ACCESS_PIN=7875
if "%DATA_FILE%"=="" set DATA_FILE=.\data\queue.json

echo Workflow System is starting...
echo This computer: http://localhost:%PORT%
echo Other devices on the same network: http://THIS-COMPUTER-IP:%PORT%
echo Keep this window open while employees use the app.
node server.js
pause

