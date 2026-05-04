@echo off
REM Create superuser: superuser@fserp.com / Admin@123
cd /d "%~dp0"
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)
python manage.py create_superuser --username "superuser@fserp.com" --password "Admin@123" --email "superuser@fserp.com"
pause
