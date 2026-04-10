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

Write-Host "Starting backend on http://localhost:8000 ..." -ForegroundColor Green
Write-Host "API docs: http://localhost:8000/api/docs" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
& ".\venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
