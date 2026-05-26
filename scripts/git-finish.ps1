# Finish FSERP git + GitHub setup on this PC.
# Run: powershell -ExecutionPolicy Bypass -File scripts\git-finish.ps1
# If commit fails with "unable to write index", run this script as Administrator once.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $repoRoot) -eq "scripts") { $repoRoot = Split-Path -Parent $repoRoot }

$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
$safe = "safe.directory=$repoRoot"

function Invoke-Git {
    & git -c $safe @args
}

Set-Location $repoRoot

Write-Host "=== Git + GitHub finish setup ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot`n"

# 1) PATH / version
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git not on PATH. Restart terminal or reinstall Git." -ForegroundColor Red
    exit 1
}
Invoke-Git --version

# 2) Fix .git permissions (needs admin if repo was copied from another PC)
$gitDir = Join-Path $repoRoot ".git"
$testIndex = Join-Path $gitDir "index.test-write"
try {
    [IO.File]::WriteAllText($testIndex, "test")
    Remove-Item $testIndex -Force
    Write-Host "[OK] .git folder is writable" -ForegroundColor Green
} catch {
    Write-Host "[FIX] .git not writable for current user — taking ownership (Admin)..." -ForegroundColor Yellow
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "Re-run as Administrator:" -ForegroundColor Red
        Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -ForegroundColor Yellow
        exit 1
    }
    takeown /F $gitDir /R /D Y | Out-Null
    icacls $gitDir /grant "$($env:USERNAME):(OI)(CI)F" /T | Out-Null
    Write-Host "[OK] Permissions fixed" -ForegroundColor Green
}

# 3) Git identity (per-command only; no global or repo config changes)
$script:GitUser = @("-c", "user.name=hkabir845", "-c", "user.email=62505027+hkabir845@users.noreply.github.com")
function Invoke-GitCommit {
    & git -c $safe @GitUser @args
}
Write-Host "[OK] Using commit author from existing FSERP history" -ForegroundColor Green

# 4) GitHub CLI login
$authOk = $false
try {
    gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $authOk = $true }
} catch { }
if (-not $authOk) {
    Write-Host "`nLog in to GitHub (browser will open):" -ForegroundColor Yellow
    gh auth login -h github.com -p https -w
}
gh auth status

# 5) Commit local dev fixes
Write-Host "`n=== Commit ===" -ForegroundColor Cyan
Invoke-Git add .gitignore backend/run-backend.ps1 backend/runserver.ps1 `
    frontend/node.cmd frontend/run-dev.ps1 frontend/run.bat frontend/start.bat scripts/dev-setup.ps1
$status = Invoke-Git status --porcelain
if ($status) {
    Invoke-GitCommit commit -m "Fix Windows local dev: Python venv-local, Next.js PATH, and gitignore"
    Write-Host "[OK] Committed" -ForegroundColor Green
} else {
    Write-Host "Nothing to commit (already clean)" -ForegroundColor DarkGray
}

# 6) Push
Write-Host "`n=== Push to origin ===" -ForegroundColor Cyan
Invoke-Git remote -v
Invoke-Git push origin main
Write-Host "`nDone. Remote: https://github.com/hkabir845/fserp" -ForegroundColor Green
