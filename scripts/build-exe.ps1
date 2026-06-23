$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name BoothImportManager `
  --icon "assets\booth-import-manager-icon.ico" `
  --add-data "webui;webui" `
  local_app\launcher.py `
  --distpath dist `
  --workpath build

Write-Host "Built: $root\dist\BoothImportManager.exe"
