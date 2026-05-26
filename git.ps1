# Run git in this repo (safe.directory + PATH). Usage: .\git.ps1 status
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;$env:Path"
$repo = (Resolve-Path $PSScriptRoot).Path -replace '\\', '/'
& git -c "safe.directory=$repo" -C $PSScriptRoot @args
