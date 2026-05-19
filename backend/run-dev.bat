@echo off
setlocal
cd /d "%~dp0"

set "VENV_PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
  echo ERROR: Missing %VENV_PY%
  echo Run from repo root: powershell -File scripts\dev-setup.ps1
  exit /b 1
)

node "%~dp0scripts\free-port-8000.mjs" 2>nul
echo Starting Django on http://127.0.0.1:8000 ...
"%VENV_PY%" manage.py runserver 127.0.0.1:8000 %*
