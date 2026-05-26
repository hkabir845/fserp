@echo off
REM Local shim: "python" in backend folder -> repo-root venv (no global PATH needed).
set "PY=%~dp0..\.venv-local\Scripts\python.exe"
if not exist "%PY%" set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo ERROR: No Python venv found. Run: powershell -File "%~dp0..\scripts\dev-setup.ps1"
  exit /b 1
)
"%PY%" %*
