# Install Git for Windows (user scope) when `git` is not on PATH.
# Run from repo root:  pwsh -File scripts/install-git.ps1

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

$existing = Find-GitExe
if ($existing) {
    Write-Host "Git already available: $existing" -ForegroundColor Green
    & $existing --version
    exit 0
}

$releaseTag = "v2.47.1.windows.2"
$installerName = "Git-2.47.1.2-64-bit.exe"
$installerUrl = "https://github.com/git-for-windows/git/releases/download/$releaseTag/$installerName"
$cacheDir = Join-Path $env:LOCALAPPDATA "FSERP-install-cache"
$installerPath = Join-Path $cacheDir $installerName
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Git"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (-not (Test-Path $installerPath)) {
    Write-Host "Downloading Git $version ..." -ForegroundColor Cyan
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source -fsSL -o $installerPath $installerUrl
        if ($LASTEXITCODE -ne 0) { throw "curl download failed (exit $LASTEXITCODE)" }
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    }
}

Write-Host "Installing Git to $installDir (silent) ..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $installerPath -ArgumentList @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/NOCANCEL",
    "/SP-",
    "/CLOSEAPPLICATIONS",
    "/RESTARTAPPLICATIONS",
    "/DIR=$installDir"
) -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Host "Installer exit code: $($proc.ExitCode)" -ForegroundColor Red
    exit $proc.ExitCode
}

$gitExe = Join-Path $installDir "cmd\git.exe"
if (-not (Test-Path $gitExe)) {
    Write-Host "ERROR: Expected $gitExe after install." -ForegroundColor Red
    exit 1
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$gitCmdDir = Join-Path $installDir "cmd"
if ($userPath -notlike "*$gitCmdDir*") {
    $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $gitCmdDir } else { "$userPath;$gitCmdDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$gitCmdDir"
    Write-Host "Added Git to user PATH. Restart the terminal (or Cursor) to pick it up everywhere." -ForegroundColor Yellow
}

Write-Host "Git installed:" -ForegroundColor Green
& $gitExe --version
