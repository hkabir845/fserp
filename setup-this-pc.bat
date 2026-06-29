@echo off
REM Run once after plugging this project drive into a new PC (or when backend won't start).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-setup.ps1" %*
if errorlevel 1 exit /b 1
echo.
echo Next: open two terminals and run:
echo   backend\run-dev.bat
echo   frontend\run-dev.bat
pause
