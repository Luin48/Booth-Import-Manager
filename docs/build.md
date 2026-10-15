# 빌드

## 자동 (GitHub Actions)

저장소 **Actions → Build & Release → Run workflow** 에 버전(예: `0.3.1`)을 넣고 실행하면
윈도우에서 exe를 빌드하고, 크롬 확장 zip·유니티 패키지와 함께 릴리즈를 만듭니다.
릴리즈 본문은 `docs/release-notes-v<버전>.md` 를 씁니다. (먼저 만들어 두어야 함)

## 직접

- Windows, Python 3.12+

```powershell
python -m pip install pyinstaller pillow
.\scripts\build-exe.ps1                       # dist\BoothImportManager.exe
python scripts\make_unitypackage.py           # dist\BoothImportManager.unitypackage
```

빌드 없이 실행: `.\scripts\run-dev.ps1`
시작프로그램 등록: `.\scripts\install-startup.ps1` (해제: `-Remove`)
