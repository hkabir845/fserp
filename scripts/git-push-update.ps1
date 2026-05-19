# Stage all changes, commit, and push to origin/main.
# Usage:
#   pwsh -File scripts/git-push-update.ps1
#   pwsh -File scripts/git-push-update.ps1 -Message "My commit message"
#   pwsh -File scripts/git-push-update.ps1 -Branch develop/aquaculture

param(
    [string]$Message = "Update",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Find-GitExe {
    $candidates = @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\PortableGit\cmd\git.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Split-Path -Leaf $repoRoot) -eq "scripts") {
    $repoRoot = Split-Path -Parent $repoRoot
}
Set-Location $repoRoot

$git = Find-GitExe
if (-not $git) {
    Write-Host "Git not found. Run:  pwsh -File scripts/install-git.ps1" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".git")) {
    Write-Host "ERROR: Not a git repository: $repoRoot" -ForegroundColor Red
    exit 1
}

function Invoke-Git {
    param([string[]]$GitArgs)
    & $git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE)"
    }
}

Write-Host "Repository: $repoRoot" -ForegroundColor Cyan
Invoke-Git @("status", "--short")

Invoke-Git @("add", ".")
$status = & $git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit — working tree clean." -ForegroundColor Yellow
    exit 0
}

Invoke-Git @("commit", "-m", $Message)
Invoke-Git @("push", "origin", $Branch)

Write-Host "Done: pushed to origin/$Branch" -ForegroundColor Green
