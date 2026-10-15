# 빌드 없이 파이썬으로 바로 실행 (개발/테스트용)
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "local_app")
python launcher.py @args
