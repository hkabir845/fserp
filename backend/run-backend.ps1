# Run backend server (no PATH needed - uses venv's Python directly)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$venvPy = Join-Path (Split-Path $PSScriptRoot -Parent) ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "ERROR: Virtual environment not found at $venvPy" -ForegroundColor Red
    Write-Host "Run: powershell -File scripts\dev-setup.ps1" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path ".env")) {
    Write-Host "ERROR: .env not found. Copy env.example to .env or run setup.bat." -ForegroundColor Red
    exit 1
}

Write-Host "Starting Django on http://127.0.0.1:8000 ..." -ForegroundColor Green
Write-Host "API docs: http://127.0.0.1:8000/api/docs" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
& $venvPy manage.py runserver 127.0.0.1:8000
