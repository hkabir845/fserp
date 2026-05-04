@echo off
REM Windows Setup Script for Backend

echo ================================
echo Backend Setup - Filling Station ERP
echo ================================

REM Create virtual environment if it doesn't exist
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate

REM Install dependencies
echo Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt

REM Create .env file if it doesn't exist
if not exist ".env" (
    echo Creating .env file...
    python -c "import secrets; key = secrets.token_urlsafe(32)" > .env
    echo DATABASE_URL=postgresql://postgres:password@localhost:5432/fserp_dev >> .env
    echo SECRET_KEY=%key% >> .env
    echo DEBUG=True >> .env
    echo ALLOWED_ORIGINS=http://localhost:3000 >> .env
)

echo.
echo Setup complete!
echo.
echo To run the server:
echo   1. Make sure PostgreSQL is running
echo   2. Run: venv\Scripts\activate
echo   3. Run: uvicorn app.main:app --reload
echo.

pause

















