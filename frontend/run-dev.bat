@echo off
cd /d "%~dp0"
echo Stopping anything on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
if exist "%LOCALAPPDATA%\Programs\nodejs-portable\npm.cmd" (
  "%LOCALAPPDATA%\Programs\nodejs-portable\npm.cmd" run dev
) else (
  echo ERROR: npm not found at %LOCALAPPDATA%\Programs\nodejs-portable
  exit /b 1
)
