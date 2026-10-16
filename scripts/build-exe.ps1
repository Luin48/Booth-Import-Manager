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
  --add-data "unity_package;unity_package" `
  --add-data "assets;assets" `
  --hidden-import pystray._win32 `
  --hidden-import tkinter `
  local_app\launcher.py `
  --distpath dist `
  --workpath build

Write-Host "Built: $root\dist\BoothImportManager.exe"
