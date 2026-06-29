# FSERP — reset machine-specific deps after moving the project to another PC.
# Same as dev-setup.ps1 but always recreates the Python venv.
# Run: pwsh -File scripts/portable-setup.ps1

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "dev-setup.ps1") -Force
