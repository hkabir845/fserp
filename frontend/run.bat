@echo off
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
if not exist "%ProgramFiles%\nodejs\node.exe" (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
echo Next.js frontend: http://localhost:3000
"%ProgramFiles%\nodejs\npm.cmd" run dev
pause
