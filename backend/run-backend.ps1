# Run Django backend (uses repo-root .venv-local or .venv).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repoRoot = Split-Path $PSScriptRoot -Parent
$venvPy = Join-Path $repoRoot ".venv-local\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    $venvPy = Join-Path $repoRoot ".venv\Scripts\python.exe"
}
if (-not (Test-Path $venvPy)) {
    Write-Host "ERROR: No Python venv found." -ForegroundColor Red
    Write-Host "Run: powershell -File $repoRoot\scripts\dev-setup.ps1" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path ".env") -and (Test-Path "env.example")) {
    Copy-Item "env.example" ".env"
    Write-Host "Created backend/.env from env.example" -ForegroundColor Green
}

$env:FSERP_USE_SQLITE = "1"
$env:DATABASE_URL = ""
$env:DJANGO_CACHE_URL = ""
$env:REDIS_URL = ""

Write-Host "Starting Django on http://127.0.0.1:8000 ..." -ForegroundColor Green
Write-Host "API docs: http://127.0.0.1:8000/api/docs/" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
& $venvPy manage.py runserver 127.0.0.1:8000 @args
