@echo off
REM Audit log is managed by Django migrations.
cd /d "%~dp0"
call venv\Scripts\activate 2>nul
python manage.py migrate
pause
