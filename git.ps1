# Optional helper — normal `git` works after .git was re-initialized.
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;$env:Path"
Set-Location $PSScriptRoot
& git.exe @args
