@echo off
REM Restore demo data via Django management commands.
cd /d "%~dp0"
call venv\Scripts\activate 2>nul
echo Seeding demo data (existing DB is updated, not dropped)...
python manage.py ensure_master_template
python manage.py seed_application_full_demo
echo Done. See backend/README.md for login credentials.
pause
