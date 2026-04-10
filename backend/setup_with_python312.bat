@echo off
REM ============================================================
REM  Backend setup using Python 3.12 (required - Python 3.14 breaks pydantic)
REM  Run this if start.bat shows "No module named 'pydantic_core._pydantic_core'"
REM ============================================================

cd /d "%~dp0"

echo.
echo Checking for Python 3.12...
echo.

REM Try Python 3.12 first (recommended), then 3.11
set "PYTHON_EXE="
py -3.12 -c "print('OK')" 2>nul && set "PYTHON_EXE=py -3.12"
if not defined PYTHON_EXE py -3.11 -c "print('OK')" 2>nul && set "PYTHON_EXE=py -3.11"

if not defined PYTHON_EXE (
    echo.
    echo [ERROR] Python 3.12 or 3.11 not found.
    echo.
    echo This project does NOT work with Python 3.14 - pydantic crashes.
    echo.
    echo Please install Python 3.12:
    echo   1. Go to: https://www.python.org/downloads/release/python-3120/
    echo   2. Download "Windows installer (64-bit)"
    echo   3. Run it - CHECK "Add Python to PATH"
    echo   4. Run this script again: setup_with_python312.bat
    echo.
    pause
    exit /b 1
)

echo Using: %PYTHON_EXE%
echo.

if exist "venv_new" (
    echo Removing old venv_new...
    rmdir /s /q venv_new
)

echo Creating new virtual environment (venv_new)...
%PYTHON_EXE% -m venv venv_new
if errorlevel 1 (
    echo Failed to create venv.
    pause
    exit /b 1
)

echo.
echo Installing dependencies...
call venv_new\Scripts\activate.bat
pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo pip install failed.
    pause
    exit /b 1
)

if not exist ".env" (
    echo.
    echo Creating .env file...
    if exist "env.example" (
        copy env.example .env
    ) else (
        python -c "import secrets; open('.env','w').write('DATABASE_URL=postgresql://postgres:password@localhost:5432/filling_station_erp\nSECRET_KEY='+secrets.token_urlsafe(32)+'\nDEBUG=True\nALLOWED_ORIGINS=http://localhost:3000\n')"
    )
)

echo.
echo ========================================
echo   Setup complete!
echo   Backend will use venv_new (Python 3.12/3.11).
echo   You can now run start.bat from the project root.
echo ========================================
echo.
pause
