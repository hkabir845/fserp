@echo off
cd /d "%~dp0"
set "PY="
if exist "%~dp0..\.venv-local\Scripts\python.exe" set "PY=%~dp0..\.venv-local\Scripts\python.exe"
if not defined PY if exist "%~dp0..\.venv\Scripts\python.exe" set "PY=%~dp0..\.venv\Scripts\python.exe"
if not defined PY if exist "venv_new\Scripts\python.exe" set "PY=%~dp0venv_new\Scripts\python.exe"
if not defined PY (
    echo Virtual environment not found.
    echo Run from repo root: powershell -File scripts\dev-setup.ps1
    pause
    exit /b 1
)
echo Backend (Django): https://localhost:8000
echo API docs: https://localhost:8000/api/docs/
echo.
"%PY%" manage.py runserver 8000
pause
