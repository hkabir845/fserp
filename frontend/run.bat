@echo off
cd /d "%~dp0"
set "NPM_CMD="
where npm >nul 2>&1 && set "NPM_CMD=npm"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles(x86)%\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%LOCALAPPDATA%\Programs\node\npm.cmd" set "NPM_CMD=%LOCALAPPDATA%\Programs\node\npm.cmd"
if not defined NPM_CMD (
    echo Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
if not exist "node_modules" echo Installing dependencies... && "%NPM_CMD%" install
echo Frontend: http://localhost:3000  or  http://127.0.0.1:3000
echo.
"%NPM_CMD%" run dev
pause
