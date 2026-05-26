@echo off
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo Stopping anything on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not exist "%NPM%" (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org/
  exit /b 1
)

echo Starting Next.js on http://localhost:3000 ...
"%NPM%" run dev
