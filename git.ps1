# Git for FSERP (writable metadata). Usage: .\git.ps1 add .   OR dot-source scripts\init-git-shell.ps1 then use git
. "$PSScriptRoot\scripts\init-git-shell.ps1"
git @args
