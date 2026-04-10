@echo off
REM Restore Sample Data Script
REM This will reinitialize the database with sample data

echo ========================================
echo RESTORING SAMPLE DATA
echo ========================================
echo.
echo WARNING: This will recreate the database with sample data.
echo All existing data will be lost!
echo.
pause

cd /d "%~dp0"

echo.
echo Activating virtual environment...
call venv\Scripts\activate

echo.
echo Running database initialization...
python init_database.py

echo.
echo ========================================
echo SAMPLE DATA RESTORED
echo ========================================
echo.
echo Login Credentials:
echo   Admin:      username: admin      password: admin123
echo   Accountant: username: accountant password: acc123
echo   Cashier 1:  username: cashier1   password: cash123
echo   Cashier 2:  username: cashier2   password: cash123
echo.
echo Company: Adib Filling Station Ltd
echo.
pause












