@echo off
REM Windows Setup Script for Frontend

echo ========================================
echo Frontend Setup - Filling Station ERP
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Make sure to add Node.js to your system PATH during installation.
    echo.
    pause
    exit /b 1
)

REM Check if npm is available
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm is not installed or not in PATH!
    echo.
    echo Please install Node.js (which includes npm) from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Display versions
echo [OK] Node.js and npm are available
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo   Node.js version: %NODE_VERSION%
echo   npm version: %NPM_VERSION%
echo.

REM Check if package.json exists
if not exist "package.json" (
    echo ERROR: package.json not found!
    echo Please make sure you are in the frontend directory.
    pause
    exit /b 1
)

echo [OK] package.json found
echo.

REM Install dependencies
echo ========================================
echo Installing Node.js dependencies...
echo ========================================
echo.
echo This may take a few minutes...
echo.

call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed!
    echo.
    echo Try running with legacy peer deps:
    echo   npm install --legacy-peer-deps
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Dependencies installed successfully
echo.

REM Create .env file if it doesn't exist (single env file for dev and build)
if not exist ".env" (
    echo ========================================
    echo Creating .env file...
    echo ========================================
    echo.
    (
        echo # Next.js — see README. Edit NEXT_PUBLIC_* for local API vs production.
        echo PORT=3000
        echo NEXT_PUBLIC_API_URL=https://localhost:8000
        echo NEXT_PUBLIC_API_BASE_URL=https://localhost:8000
        echo NEXT_PUBLIC_WS_URL=wss://api.mahasoftcorporation.com
        echo NEXT_PUBLIC_APP_SHELL_HOSTNAMES=localhost,127.0.0.1
        echo NEXT_PUBLIC_API_TIMEOUT=30000
        echo NEXT_PUBLIC_APP_NAME=Filling Station ERP
        echo NEXT_PUBLIC_APP_VERSION=1.0.0
        echo NEXT_PUBLIC_ENABLE_WEBSOCKET=false
        echo NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
    ) > .env
    echo [OK] .env file created
    echo.
) else (
    echo [OK] .env file already exists
    echo.
)

echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo To run the frontend:
echo   1. Run: start.bat
echo   2. Or manually: npm run dev
echo.
echo Frontend will be available at: http://localhost:3000
echo.

pause

















