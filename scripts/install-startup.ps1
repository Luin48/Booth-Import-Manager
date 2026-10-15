# 윈도우 로그인 시 Booth Import Manager 를 백그라운드(브라우저 안 열림)로 실행하도록 등록
# 사용: PowerShell 에서  .\scripts\install-startup.ps1  (해제: -Remove)
param([switch]$Remove)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")
$link = Join-Path $startup "BoothImportManager.lnk"

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link }
  Write-Host "시작프로그램에서 제거했어요."
  exit 0
}

$exe = Join-Path $root "dist\BoothImportManager.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $root "BoothImportManager.exe" }
if (-not (Test-Path $exe)) { throw "BoothImportManager.exe 를 찾지 못했어요. 먼저 scripts\build-exe.ps1 로 빌드하세요." }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $exe
$shortcut.Arguments = "--background"
$shortcut.WorkingDirectory = Split-Path -Parent $exe
$shortcut.Save()
Write-Host "등록 완료: 다음 로그인부터 백그라운드로 실행돼요. ($link)"
