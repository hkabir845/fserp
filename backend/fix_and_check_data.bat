@echo off
REM Fix Database Schema and Check Sample Data

echo ========================================
echo FIXING DATABASE SCHEMA AND CHECKING DATA
echo ========================================
echo.

cd /d "%~dp0"

echo Activating virtual environment...
call venv\Scripts\activate

echo.
echo Step 1: Adding missing payment columns to company table...
python add_company_payment_columns.py

echo.
echo Step 2: Adding missing columns to journal_entry table...
python add_missing_column.py

echo.
echo Step 2: Checking sample data...
python check_sample_data.py

echo.
echo ========================================
echo DONE
echo ========================================
echo.
echo If sample data is missing, run: restore_sample_data.bat
echo.
pause

