# Deprecated — use repo-root setup instead:
#   powershell -File scripts/dev-setup.ps1
Write-Host "Use: powershell -File scripts\dev-setup.ps1  (from repo root)" -ForegroundColor Yellow
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "scripts\dev-setup.ps1")
