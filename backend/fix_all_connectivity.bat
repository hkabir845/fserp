@echo off
REM Comprehensive Fix Script for All Application Modules
REM This script fixes data connectivity issues across the entire application

echo ========================================
echo COMPREHENSIVE APPLICATION FIX
echo ========================================
echo.

cd /d "%~dp0"

echo Activating virtual environment...
call venv\Scripts\activate

echo.
echo Step 1: Adding missing database columns...
python add_company_payment_columns.py
python add_missing_column.py

echo.
echo Step 2: Fixing user company assignments...
python fix_all_user_companies.py

echo.
echo Step 3: Checking comprehensive application status...
python comprehensive_app_check.py

echo.
echo ========================================
echo FIX COMPLETE
echo ========================================
echo.
echo Next steps:
echo   1. Restart backend server if needed
echo   2. Refresh frontend browser
echo   3. Test all modules with sample data
echo.
pause












