@echo off
cd /d "%~dp0"
set "PY="
if exist "venv_new\Scripts\python.exe" set "PY=%~dp0venv_new\Scripts\python.exe"
if exist "venv\Scripts\python.exe" set "PY=%~dp0venv\Scripts\python.exe"
if not defined PY if exist "..\venv\Scripts\python.exe" set "PY=%~dp0..\venv\Scripts\python.exe"
if not defined PY (
    echo Virtual environment not found. Run setup.bat in backend folder or create venv in project root.
    pause
    exit /b 1
)
echo Backend (Django): https://api.mahasoftcorporation.com
echo API docs: https://api.mahasoftcorporation.com/api/docs/
echo.
"%PY%" manage.py runserver 8000
pause
