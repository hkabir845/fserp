@echo off
echo ========================================
echo Restarting Backend Server
echo ========================================
echo.

REM Find and kill existing uvicorn processes
echo Stopping existing backend servers...
taskkill /F /IM uvicorn.exe 2>nul
taskkill /F /FI "WINDOWTITLE eq *uvicorn*" 2>nul
timeout /t 2 /nobreak >nul

echo.
echo Starting backend server...
echo.

REM Start server
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

pause


