# Start Next.js dev server — no PATH required.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$npm = Join-Path $env:LOCALAPPDATA "Programs\nodejs-portable\npm.cmd"
if (-not (Test-Path $npm)) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
}
if (-not $npm) {
    Write-Host "ERROR: npm not found. Run scripts\dev-setup.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "Starting Next.js on http://localhost:3000 ..." -ForegroundColor Green
& $npm run dev @args
