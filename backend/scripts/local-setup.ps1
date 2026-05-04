# One-time local setup: venv, pip install, migrate.
# Run from repo root:  pwsh -File backend/scripts/local-setup.ps1
# Or from backend:      pwsh -File scripts/local-setup.ps1

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $backendRoot

if (-not (Test-Path "venv\Scripts\Activate.ps1")) {
    python -m venv venv
}
& "venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip
pip install -r requirements.txt
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created backend/.env from .env.example (optional FRONTEND_BASE_URL etc.)." -ForegroundColor Green
}
python manage.py migrate
Write-Host "`nNext: run backend with  python manage.py runserver 8000" -ForegroundColor Cyan
Write-Host "Then frontend:  cd ../frontend && npm install && npm run dev`n" -ForegroundColor Cyan
