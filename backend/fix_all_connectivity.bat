@echo off
REM Legacy connectivity fix script — use Django management commands instead.
echo This script is deprecated. Use:
echo   python manage.py migrate
echo   python manage.py ensure_master_template
echo   python verify_backend.py
pause
