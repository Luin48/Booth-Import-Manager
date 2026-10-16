# 빌드 / 릴리즈

릴리즈 파일은 전부 파이썬 스크립트로 만듭니다.

## 자동 (GitHub Actions)

1. 버전 맞추기: `chrome_extension/manifest.json`, `unity_package/BoothImportManager/package.json`,
   `Editor/BimContext.cs`의 `Version`
2. `python scripts/make_vpm.py index` → `vpm/index.json`에 새 버전 추가 (커밋)
3. `docs/release-notes-v<버전>.md` 작성
4. **Actions → Build & Release → Run workflow** 에 버전 입력

만들어지는 파일:

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v<버전>.zip` | 크롬 확장 |
| `BoothImportManager-Unity-v<버전>.unitypackage` | 유니티 패키지 (Assets 안에 설치) |
| `local.booth-import-manager-<버전>.zip` | ALCOM/VCC 저장소용 패키지 |

## 직접

```bash
python scripts/make_unitypackage.py dist/BoothImportManager.unitypackage
python scripts/make_vpm.py zip dist/local.booth-import-manager.zip
```
