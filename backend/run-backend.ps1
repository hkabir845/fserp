# Run backend server (no PATH needed - uses venv's Python directly)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "ERROR: Virtual environment not found. Run setup.bat first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".env")) {
    Write-Host "ERROR: .env not found. Copy env.example to .env or run setup.bat." -ForegroundColor Red
    exit 1
}

Write-Host "Starting Django on http://127.0.0.1:8000 ..." -ForegroundColor Green
Write-Host "API docs: http://127.0.0.1:8000/api/docs" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
& ".\venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000
