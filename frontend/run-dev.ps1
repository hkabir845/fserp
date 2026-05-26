# Start Next.js dev server (adds Node.js to PATH for this session).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$nodeDir = "${env:ProgramFiles}\nodejs"
if (-not (Test-Path "$nodeDir\node.exe")) {
    Write-Host "ERROR: Node.js not found at $nodeDir" -ForegroundColor Red
    Write-Host "Install from https://nodejs.org/ then restart the terminal." -ForegroundColor Yellow
    exit 1
}

$env:Path = "$nodeDir;$env:Path"
$npm = "$nodeDir\npm.cmd"

Write-Host "Starting Next.js on http://localhost:3000 ..." -ForegroundColor Green
Write-Host "Backend should be at http://127.0.0.1:8000" -ForegroundColor Cyan
& $npm run dev @args
