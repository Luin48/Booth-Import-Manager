## Booth Import Manager v1.1.0

> **정식 릴리즈 버전입니다.**

기능은 v1.0.2와 같습니다. 유니티 패키지에 추가 도구(썸네일 매칭)가 쓰는 기능이 들어갔고, 그 밖의 동작은 바뀌지 않았습니다.

### 썸네일 매칭은 v1.1.0-1로 분리

BIM을 쓰기 전에 직접 넣어둔 에셋 폴더에 BOOTH 썸네일을 한 번에 붙이는 **썸네일 매칭** 기능을 만들었습니다. 다만 **처음 1회 실행하고 나면 다시 쓸 일이 없는 기능이라 정식 버전에서 분리**해 [v1.1.0-1](https://github.com/Luin48/Booth-Import-Manager/releases/tag/v1.1.0-1)에 따로 올려 두었습니다.

- 필요하면 v1.1.0-1의 크롬 확장 + BIM Thumbnail Matcher로 한 번 실행한 뒤, 이 v1.1.0으로 돌아오면 됩니다.
- 붙인 아이콘은 Booth Import Manager 유니티 패키지가 그리므로 v1.1.0에서도 그대로 남습니다.

### 1.0.2 이후 바뀐 점

- 유니티 패키지: 추가 도구용 기능 추가 (zip 항목 읽기, 폴더 아이콘 조회). 사용자에게 보이는 변화는 없습니다.

### 설치·업데이트

- **크롬 확장**: 아래 zip을 풀어 기존 폴더에 덮어쓰고 `chrome://extensions`에서 ↻
- **유니티 패키지**: ALCOM/VCC에서 Booth Import Manager를 1.1.0으로 업데이트, 또는 아래 unitypackage 임포트

### 받을 파일

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v1.1.0.zip` | 크롬 확장 |
| `BoothImportManager-Unity-v1.1.0.unitypackage` | 유니티 패키지 |
| `local.booth-import-manager-1.1.0.zip` | ALCOM/VCC(VPM)용 |
