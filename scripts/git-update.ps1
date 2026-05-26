# Stage all changes, commit "Update", and push to GitHub.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\git-update.ps1

$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $root) -eq "scripts") { $root = Split-Path -Parent $root }
Set-Location $root

git add .
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit — working tree clean." -ForegroundColor Yellow
    exit 0
}

git status -sb
git commit -m "Update"
git push origin main
Write-Host "Done. Pushed to https://github.com/hkabir845/fserp" -ForegroundColor Green
