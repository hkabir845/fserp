# Makes `git add` / `commit` / `push` work in D:\ITProjects\FSERP (writable git-dir).
# Auto-loaded in Cursor terminal via .vscode/settings.json

$script:FSERP_GIT_DIR = Join-Path $env:LOCALAPPDATA "FSERP-github\.git"
$script:FSERP_WORK_TREE = "D:/ITProjects/FSERP"

if (-not (Test-Path $script:FSERP_GIT_DIR)) {
    Write-Host "WARN: Run scripts\sync-git-dir.ps1 first to create FSERP-github clone." -ForegroundColor Yellow
}

function git {
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)]$Args)
    $env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
    & "C:\Program Files\Git\cmd\git.exe" `
        --git-dir="$script:FSERP_GIT_DIR" `
        --work-tree="$script:FSERP_WORK_TREE" `
        -c "user.name=hkabir845" `
        -c "user.email=62505027+hkabir845@users.noreply.github.com" `
        @Args
}

Set-Location $script:FSERP_WORK_TREE
Write-Host "FSERP git ready (work-tree: D:\ITProjects\FSERP)" -ForegroundColor DarkGray
