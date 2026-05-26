# Push main to GitHub with clear errors.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\git-push.ps1

$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $root) -eq "scripts") { $root = Split-Path -Parent $root }
Set-Location $root

Write-Host "Remote:" -ForegroundColor Cyan
git remote -v
Write-Host ""

$ahead = git rev-list --count origin/main..main 2>$null
if ($ahead -match '^\d+$' -and [int]$ahead -eq 0) {
    $porcelain = git status --porcelain
    if ($porcelain) {
        Write-Host "Nothing to push — you have uncommitted changes. Run:" -ForegroundColor Yellow
        Write-Host "  git add ."
        Write-Host "  git commit -m `"Update`""
        Write-Host "  git push origin main"
        exit 1
    }
    Write-Host "Everything up-to-date (GitHub already has your latest commit)." -ForegroundColor Green
    git log -1 --oneline
    exit 0
}

Write-Host "Pushing $ahead commit(s) to origin/main ..." -ForegroundColor Cyan
$pushOut = git push origin main 2>&1 | Out-String
Write-Host $pushOut

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push failed — usually GitHub login." -ForegroundColor Red
    Write-Host "Fix (one time):" -ForegroundColor Yellow
    Write-Host "  gh auth login"
    Write-Host "  (choose GitHub.com, HTTPS, login in browser)"
    Write-Host ""
    Write-Host "Then run again: git push origin main"
    exit $LASTEXITCODE
}

Write-Host "Push OK." -ForegroundColor Green
