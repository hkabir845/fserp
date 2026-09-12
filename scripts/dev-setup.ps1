# FSERP — local environment setup (Windows).
# Run from repo root:  pwsh -File scripts/dev-setup.ps1
# After moving the project drive to another PC, run again (or use setup-this-pc.bat).
#
# Stack: Django 5 API (backend/) + Next.js UI (frontend/) + PostgreSQL
# Set DATABASE_URL in backend/.env before running migrations.
# After setup: backend/run-dev.bat + frontend/run-dev.bat

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Host "ERROR: Python 3.12 not found. Install from https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

$npm = "$env:ProgramFiles\nodejs\npm.cmd"
if (-not (Test-Path $npm)) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
}
if (-not $npm) {
    Write-Host "WARN: npm not found — install Node.js (Next.js runtime) or fix PATH." -ForegroundColor Yellow
}

# --- Python / Django ---
. (Join-Path $repoRoot "scripts\resolve-venv.ps1")
$venvPy = if ($Force) { $null } else { Get-FserpVenvPython -Root $repoRoot }
if (-not $venvPy) {
  if (-not $Force) {
    Write-Host "No working Python venv on this PC (common after moving a portable drive)." -ForegroundColor Yellow
  }
  foreach ($broken in @(".venv", ".venv-local", "backend\venv")) {
    $dir = Join-Path $repoRoot $broken
    if (Test-Path $dir) {
      Write-Host "Removing stale venv: $broken" -ForegroundColor DarkYellow
      Remove-Item $dir -Recurse -Force
    }
  }
  Write-Host "Creating .venv-local with $python ..." -ForegroundColor Cyan
  & $python -m venv (Join-Path $repoRoot ".venv-local")
  if ($LASTEXITCODE -ne 0) { throw "Python virtual environment creation failed." }
  $venvPy = Get-FserpVenvPython -Root $repoRoot
  if (-not $venvPy) {
    Write-Host "ERROR: Failed to create a working venv." -ForegroundColor Red
    exit 1
  }
}
& $venvPy -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $venvPy -m pip install -r (Join-Path $repoRoot "requirements-django.txt")
if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed." }

$backend = Join-Path $repoRoot "backend"
if (-not (Test-Path "$backend\.env") -and (Test-Path "$backend\env.example")) {
    Copy-Item "$backend\env.example" "$backend\.env"
    Write-Host "Created backend/.env from env.example" -ForegroundColor Green
}

# Local dev overrides (loaded after .env; does not replace production values)
$localEnvDir = "$backend\env"
$localEnvFile = "$localEnvDir\.env"
if (-not (Test-Path $localEnvDir)) { New-Item -ItemType Directory -Path $localEnvDir | Out-Null }
@(
    "FRONTEND_BASE_URL=http://localhost:3000",
    "FSERP_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000",
    "FSERP_CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000"
) | Set-Content -Path $localEnvFile -Encoding utf8
Write-Host "Wrote backend/env/.env (local CORS + frontend URL)" -ForegroundColor Green

Set-Location $backend
& $venvPy manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw "Database migration failed. Check PostgreSQL and DATABASE_URL in backend/.env." }
& $venvPy manage.py check
if ($LASTEXITCODE -ne 0) { throw "Django system checks failed." }

# --- Next.js ---
Set-Location (Join-Path $repoRoot "frontend")
if ($npm -and (Test-Path $npm)) {
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed." }
} else {
    Write-Host "Skip npm install — npm.cmd not found." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "  Backend:  http://127.0.0.1:8000  (API docs: /api/docs/)" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000  (login: /login)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run both: Cursor → Terminal → Run Task → FSERP: Run backend + frontend" -ForegroundColor Yellow
Write-Host "Dev login (if seeded): superuser@sasfserp.com / Admin@123" -ForegroundColor DarkGray
