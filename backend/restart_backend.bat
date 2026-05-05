@echo off
echo ========================================
echo Restarting Backend Server
echo ========================================
echo.

echo If port 8000 is in use, stop the other process first (Ctrl+C in that window).
timeout /t 1 /nobreak >nul

echo.
echo Starting Django backend...
echo.

call "%~dp0venv\Scripts\activate.bat"
python manage.py runserver 127.0.0.1:8000

pause


