# Ensure writable git metadata exists for FSERP (one-time / after reinstall).
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;$env:Path"
$work = Join-Path $env:LOCALAPPDATA "FSERP-github"
if (-not (Test-Path $work)) {
    git clone "https://github.com/hkabir845/fserp.git" $work
    Write-Host "Cloned to $work" -ForegroundColor Green
} else {
    Set-Location $work
    git fetch origin
    git checkout main
    git pull origin main
    Write-Host "Updated $work" -ForegroundColor Green
}
