@echo off
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not exist "%NPM%" (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org/
  exit /b 1
)

echo Stopping anything on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
ping 127.0.0.1 -n 3 >nul

echo Cleaning .next...
if exist ".next" rmdir /s /q ".next" 2>nul

echo Starting frontend (Webpack dev)...
"%NPM%" run dev
