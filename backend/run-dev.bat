@echo off
setlocal
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo Creating venv...
  python -m venv venv
  if errorlevel 1 exit /b 1
)

call "%~dp0venv\Scripts\activate.bat"
python -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo pip install failed.
  exit /b 1
)

python manage.py runserver %*
