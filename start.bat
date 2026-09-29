@echo off
rem Windows: double-click this file to start the Wallet Tracker.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, then try again.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node src\server.js
echo Tracker stopped.
pause
