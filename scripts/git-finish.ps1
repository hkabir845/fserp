# Finish FSERP GitHub push (commit already prepared in writable clone if needed).
# Run: powershell -ExecutionPolicy Bypass -File scripts\git-finish.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $repoRoot) -eq "scripts") { $repoRoot = Split-Path -Parent $repoRoot }

$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
$safe = (Resolve-Path $repoRoot).Path -replace '\\', '/'
$git = @("-c", "safe.directory=$safe", "-C", $repoRoot)
$work = Join-Path $env:LOCALAPPDATA "FSERP-github"

function Invoke-RepoGit { & git @git @args }

Write-Host "=== FSERP Git + GitHub ===" -ForegroundColor Cyan
Invoke-RepoGit --version

# GitHub login (required once on this PC)
try { gh auth status 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw "not logged in" } }
catch {
    Write-Host "`nLog in to GitHub (browser):" -ForegroundColor Yellow
    gh auth login -h github.com -p https -w
}
gh auth status

Write-Host "`n=== Repo status (D:\ITProjects\FSERP) ===" -ForegroundColor Cyan
Invoke-RepoGit status -sb
$ahead = Invoke-RepoGit rev-list --count origin/main..main 2>$null
if ($ahead -and [int]$ahead -gt 0) {
    Write-Host "Pushing $ahead commit(s) to origin/main ..." -ForegroundColor Green
    Invoke-RepoGit push origin main
} elseif (Test-Path $work) {
    Set-Location $work
    $workAhead = git rev-list --count origin/main..main 2>$null
    if ($workAhead -and [int]$workAhead -gt 0) {
        Write-Host "Pushing from work clone ($work) ..." -ForegroundColor Green
        git push origin main
    } else {
        Write-Host "Already up to date with GitHub." -ForegroundColor Green
    }
} else {
    Write-Host "Nothing to push." -ForegroundColor DarkGray
}

Write-Host "`nRemote: https://github.com/hkabir845/fserp" -ForegroundColor Cyan
Write-Host "Tip: use .\git.ps1 instead of git in this folder (safe.directory)." -ForegroundColor DarkGray
