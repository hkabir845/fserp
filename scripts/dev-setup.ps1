# FSERP — one-time local environment setup (Windows).
# Run from repo root:  pwsh -File scripts/dev-setup.ps1
#
# Stack: Django 5 API (backend/) + Next.js UI (frontend/) + SQLite (dev)
# After setup: Terminal → Run Task → "FSERP: Run backend + frontend"

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
$venvPy = Get-FserpVenvPython -Root $repoRoot
if (-not $venvPy) {
  foreach ($broken in @(".venv", ".venv-local")) {
    $dir = Join-Path $repoRoot $broken
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  }
  Write-Host "Creating .venv-local ..." -ForegroundColor Cyan
  & $python -m venv (Join-Path $repoRoot ".venv-local")
  $venvPy = Get-FserpVenvPython -Root $repoRoot
}
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r (Join-Path $repoRoot "requirements-django.txt")

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
& $venvPy manage.py check

# --- Next.js ---
Set-Location (Join-Path $repoRoot "frontend")
if (Test-Path $npm) {
    & $npm install
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
