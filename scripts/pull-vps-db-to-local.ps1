# Download VPS live PostgreSQL dump and restore into local fserp database.
#
# Option A - dump on VPS, then download + restore:
#   powershell -File scripts/pull-vps-db-to-local.ps1 -VpsHost mahasoftcorporation.com -VpsUser sas
#
# Option B - local dump file already downloaded:
#   powershell -File scripts/pull-vps-db-to-local.ps1 -DumpFile backend/backups/fserp_live_latest.dump
#
param(
    [string]$VpsHost = "mahasoftcorporation.com",
    [string]$VpsUser = "sas",
    [string]$VpsRepo = "~/fserp/fserp",
    [string]$DumpFile = "",
    [string]$LocalDatabaseUrl = "",
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $RepoRoot "backend"
$Backups = Join-Path $Backend "backups"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"

if (-not (Test-Path "$PgBin\pg_restore.exe")) {
    throw "pg_restore not found at $PgBin. Install PostgreSQL client tools or edit PgBin in this script."
}

function Get-DatabaseUrl {
    param([string]$Override)
    if ($Override) { return $Override.Trim() }
    $envPath = Join-Path $Backend ".env"
    if (-not (Test-Path $envPath)) { throw "Missing $envPath" }
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^DATABASE_URL=(.+)$') {
            return $Matches[1].Trim()
        }
    }
    throw "DATABASE_URL not set in backend/.env"
}

function Get-DbNameFromUrl {
    param([string]$Url)
    $uri = [Uri]$Url
    return $uri.AbsolutePath.TrimStart('/')
}

New-Item -ItemType Directory -Force -Path $Backups | Out-Null

$localUrl = Get-DatabaseUrl -Override $LocalDatabaseUrl
$dbName = Get-DbNameFromUrl -Url $localUrl

if (-not $DumpFile) {
    $remoteDump = "${VpsUser}@${VpsHost}:${VpsRepo}/backend/backups/fserp_live_latest.dump"
    $DumpFile = Join-Path $Backups "fserp_live_latest.dump"
    if (-not $SkipDownload) {
        Write-Host "==> Downloading $remoteDump"
        & scp.exe $remoteDump $DumpFile
    }
} else {
    $DumpFile = Join-Path $RepoRoot ($DumpFile -replace '/', '\')
}

if (-not (Test-Path $DumpFile)) {
    throw "Dump file not found: $DumpFile. On VPS run: bash scripts/vps-export-live-db.sh"
}

$fileSize = (Get-Item $DumpFile).Length
Write-Host "==> Restoring $DumpFile ($fileSize bytes) into local database '$dbName'"

$adminUrl = $localUrl -replace "/$dbName(\?.*)?$", "/postgres`$1"
if ($adminUrl -eq $localUrl) {
    $adminUrl = "postgres://postgres:postgres@127.0.0.1:5432/postgres"
}

Write-Host "==> Terminating open connections to $dbName"
$terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$dbName' AND pid <> pg_backend_pid();"
& "$PgBin\psql.exe" $adminUrl -v ON_ERROR_STOP=1 -c $terminateSql | Out-Null

Write-Host "==> Dropping and recreating $dbName"
& "$PgBin\dropdb.exe" --if-exists -h 127.0.0.1 -U postgres $dbName
& "$PgBin\createdb.exe" -h 127.0.0.1 -U postgres $dbName

Write-Host "==> pg_restore (this may take a minute)"
& "$PgBin\pg_restore.exe" --no-owner --no-acl -h 127.0.0.1 -U postgres -d $dbName $DumpFile

Write-Host ""
Write-Host "Local database restored from VPS live dump."
Write-Host "Verify with Django manage.py shell and Company.objects.count()"
