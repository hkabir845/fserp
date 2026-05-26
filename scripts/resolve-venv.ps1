# Resolve a working repo-root venv Python (prefers .venv-local, then .venv).
param(
    [string]$RepoRoot = $(Split-Path -Parent $PSScriptRoot)
)

function Test-FserpVenvHealthy {
    param([string]$VenvDir)
    $py = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $py)) { return $false }
    $cfgPath = Join-Path $VenvDir "pyvenv.cfg"
    if (Test-Path $cfgPath) {
        $homeLine = Get-Content $cfgPath -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '^home\s*=' } |
            Select-Object -First 1
        if ($homeLine -match '=\s*(.+)') {
            $homePy = Join-Path ($Matches[1].Trim().Trim('"')) "python.exe"
            if (-not (Test-Path $homePy)) { return $false }
        }
    }
    try {
        & $py -c "import sys" 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-FserpVenvPython {
    param([string]$Root = $RepoRoot)
    foreach ($name in @(".venv-local", ".venv")) {
        $dir = Join-Path $Root $name
        if (Test-FserpVenvHealthy $dir) {
            return (Join-Path $dir "Scripts\python.exe")
        }
    }
    return $null
}
