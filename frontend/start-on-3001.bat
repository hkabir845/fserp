@echo off
REM Start frontend on port 3001 (use when 3000 is already in use)
cd /d "%~dp0"
echo Starting frontend on http://localhost:3001
echo.
call npm run dev -- -p 3001
pause
