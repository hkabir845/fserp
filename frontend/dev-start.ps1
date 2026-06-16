# Ensure Node.js is on PATH (for Cursor/terminals that don't have it)
$nodePath = "C:\Program Files\nodejs"
if ($env:Path -notlike "*nodejs*") {
    $env:Path = "$nodePath;" + $env:Path
}

Set-Location $PSScriptRoot
Write-Host "Starting Next.js dev server. Open http://127.0.0.1:3000 in your browser." -ForegroundColor Cyan
npm run dev
