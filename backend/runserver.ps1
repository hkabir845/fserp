# Start Django — no PATH / "python" required (uses repo-root .venv).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$venvPy = Join-Path (Split-Path $PSScriptRoot -Parent) ".venv-local\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    $venvPy = Join-Path (Split-Path $PSScriptRoot -Parent) ".venv\Scripts\python.exe"
}
if (-not (Test-Path $venvPy)) {
    Write-Host "ERROR: Missing $venvPy" -ForegroundColor Red
    Write-Host "Run from repo root:  powershell -File scripts\dev-setup.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting Django on http://127.0.0.1:8000 ..." -ForegroundColor Green
& $venvPy manage.py runserver 127.0.0.1:8000 @args
