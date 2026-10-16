## Booth Import Manager v1.0.3

### 새 추가 도구: 썸네일 매칭 (BIM Thumbnail Matcher 1.0.0)

BIM을 쓰기 전에 직접 넣어둔 에셋 폴더에도 BOOTH 썸네일을 붙이는 유니티 창입니다. 따로 설치하는 패키지예요.

- `Tools > Booth Import Manager > 썸네일 매칭 (설치된 에셋)`
- 크롬 확장이 저장한 BOOTH 라이브러리 목록과 Assets 폴더를 대조
  - **원본 파일 대조**: 보관·다운로드 폴더의 zip/unitypackage 안 GUID로 정확히 찾기 (폴더를 옮겼어도 OK)
  - **이름 대조**: 분류 폴더(`01.헤어` 등)는 건너뛰고, 샵 폴더 → 그 샵의 상품 순으로 비교
- 결과: **자동 매칭** / **확인 필요**(후보 카드에서 고르기) / **못 찾음**(직접 찾기·숨기기) / **이미 있음**
- 선택한 폴더에 상품 썸네일, 샵 폴더에 샵 프로필 사진

### 크롬 확장

- BOOTH 라이브러리 맨 위 BIM 줄에 **🖼 썸네일 매칭용 목록 저장** (관리 페이지 → 설정에도 있음)
  - 구매·선물 목록을 `다운로드\BoothImportManager\_bim\library.json`에 저장 (외부로 보내지 않음)
  - 유니티 창의 **부스에서 불러오기**를 누르면 자동으로 실행

### 유니티 패키지

- 추가 도구용 기능 추가 (zip 항목 읽기, 폴더 아이콘 조회). 그 밖의 동작은 1.0.2와 같습니다.

### 설치·업데이트

- **크롬 확장**: 아래 zip을 풀어 기존 폴더에 덮어쓰고 `chrome://extensions`에서 ↻
- **유니티 패키지**: ALCOM/VCC에서 Booth Import Manager를 1.0.3으로 업데이트하고, 필요하면 **BIM Thumbnail Matcher**를 추가
  - 직접 넣으려면 아래 두 unitypackage를 임포트 (Thumbnail Matcher는 Booth Import Manager가 있어야 동작)

### 받을 파일

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v1.0.3.zip` | 크롬 확장 |
| `BoothImportManager-Unity-v1.0.3.unitypackage` | 유니티 패키지 |
| `BoothThumbnailMatcher-Unity-v1.0.0.unitypackage` | 추가 도구: 썸네일 매칭 |
| `local.booth-import-manager-1.0.3.zip`, `local.booth-thumbnail-matcher-1.0.0.zip` | ALCOM/VCC(VPM)용 |
