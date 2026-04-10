@echo off
REM ========================================
REM Create Audit Log Table
REM ========================================

echo.
echo ========================================
echo   Creating Audit Log Table
echo ========================================
echo.

cd /d "%~dp0backend"

REM Check if Python is installed
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b 1
)

REM Check if venv exists
if not exist "venv\" (
    echo [ERROR] Virtual environment not found!
    pause
    exit /b 1
)

echo [OK] Activating virtual environment...
call venv\Scripts\activate

echo [OK] Running audit log table creation script...
python create_audit_log_table.py

echo.
echo ========================================
echo   Migration Complete
echo ========================================
echo.

pause
