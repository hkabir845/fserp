# Install backend only: .venv, pip deps, .env, migrate.
# Run: powershell -File scripts\install-backend.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $repoRoot) -eq "scripts") {
    $repoRoot = Split-Path -Parent $repoRoot
}
Set-Location $repoRoot

$python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Host "ERROR: Python 3.12 not found." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating .venv ..." -ForegroundColor Cyan
    & $python -m venv .venv
}

$venvPy = Join-Path $repoRoot ".venv\Scripts\python.exe"
Write-Host "Installing Python packages ..." -ForegroundColor Cyan
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r (Join-Path $repoRoot "requirements-django.txt")

$backend = Join-Path $repoRoot "backend"
if (-not (Test-Path "$backend\.env") -and (Test-Path "$backend\env.example")) {
    Copy-Item "$backend\env.example" "$backend\.env"
    Write-Host "Created backend/.env" -ForegroundColor Green
}

$localEnvDir = "$backend\env"
if (-not (Test-Path $localEnvDir)) { New-Item -ItemType Directory -Path $localEnvDir | Out-Null }
@(
    "FRONTEND_BASE_URL=http://localhost:3000",
    "FSERP_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000",
    "FSERP_CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000"
) | Set-Content -Path "$localEnvDir\.env" -Encoding utf8

Set-Location $backend
Write-Host "Running migrations ..." -ForegroundColor Cyan
& $venvPy manage.py migrate --noinput
& $venvPy manage.py check

Write-Host ""
Write-Host "Backend environment ready." -ForegroundColor Green
Write-Host "  Run: cd backend; ..\.venv\Scripts\python.exe manage.py runserver" -ForegroundColor Cyan
Write-Host "  Or:  .\runserver.ps1" -ForegroundColor Cyan
