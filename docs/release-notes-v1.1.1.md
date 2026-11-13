## Booth Import Manager v1.1.1

> **정식 릴리즈 버전입니다.** (썸네일 매칭 도구는 [v1.1.0-1](https://github.com/Luin48/Booth-Import-Manager/releases/tag/v1.1.0-1)에 따로 있습니다)

### 바뀐 점

- **unitypackage 없는 상품도 유니티로**: 텍스쳐·머티리얼만 든 zip이나 이미지 파일 하나짜리 상품을 `<태그>/<샵 이름>/<상품 이름>/` 폴더를 만들어 그대로 넣습니다.
  - zip을 감싸는 폴더는 빼고 하위 폴더 구조는 유지
  - zip 안의 `.meta`도 같이 넣어서 머티리얼 ↔ 텍스쳐 연결 유지
  - 상품 폴더에는 상품 썸네일, 샵 폴더에는 샵 프로필 사진 아이콘
  - 같은 샵 사진이 붙은 샵 폴더가 태그 폴더에 이미 있으면 그 폴더에 넣음
  - 폴더 이름에서 `【…】`, `[…]` 꾸밈 괄호는 빼고 60자까지
  - `.blend`(블렌더가 없으면 유니티 오류), 압축·실행 파일, 맥 찌꺼기 파일(`__MACOSX`, `.DS_Store`)은 넣지 않음
- rar·7z 압축은 아직 풀지 못합니다 (`패키지 없음` + 안내)

크롬 확장은 1.1.0과 같고 버전 번호만 1.1.1입니다.

### 설치·업데이트

- **유니티 패키지**: ALCOM/VCC에서 Booth Import Manager를 1.1.1로 업데이트, 또는 아래 unitypackage 임포트
- **크롬 확장**: 바뀐 내용은 없지만 맞추려면 아래 zip을 풀어 기존 폴더에 덮어쓰고 `chrome://extensions`에서 ↻

### 받을 파일

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v1.1.1.zip` | 크롬 확장 |
| `BoothImportManager-Unity-v1.1.1.unitypackage` | 유니티 패키지 |
| `local.booth-import-manager-1.1.1.zip` | ALCOM/VCC(VPM)용 |
