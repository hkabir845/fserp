# Fix FSERP folder + .git permissions for current user (run as Administrator).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\fix-git-permissions.ps1

$ErrorActionPreference = "Stop"
$repo = "D:\ITProjects\FSERP"
$work = Join-Path $env:LOCALAPPDATA "FSERP-github"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Requesting Administrator..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    ) -Wait
    exit 0
}

Write-Host "Fixing ownership and ACLs on $repo ..." -ForegroundColor Cyan
takeown /F $repo /R /D Y | Out-Null
icacls $repo /inheritance:e | Out-Null
icacls $repo /grant "$($env:USERNAME):(OI)(CI)F" /T | Out-Null

if (Test-Path $work) {
    Write-Host "Refreshing .git from work clone ..." -ForegroundColor Cyan
    $bak = Join-Path $repo ".git.bak"
    if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
    if (Test-Path (Join-Path $repo ".git")) {
        Rename-Item (Join-Path $repo ".git") ".git.bak" -Force
    }
    Copy-Item (Join-Path $work ".git") (Join-Path $repo ".git") -Recurse -Force
}

Write-Host "Done. Close and reopen your terminal, then:" -ForegroundColor Green
Write-Host "  cd D:\ITProjects\FSERP"
Write-Host "  git status"
Write-Host "  git add ."
Write-Host "  git commit -m `"Update`""
Write-Host "  git push origin main"
