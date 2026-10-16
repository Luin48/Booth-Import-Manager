## Booth Import Manager v1.1.0-1 — 썸네일 매칭 포함판

> **정식 릴리즈 버전은 [v1.1.0](https://github.com/Luin48/Booth-Import-Manager/releases/tag/v1.1.0)입니다.**
> 이 버전은 v1.1.0에 **썸네일 매칭** 기능을 더한 것입니다. 썸네일 매칭은 이미 설치해 둔 에셋에 썸네일을 붙이는 기능이라 **처음 1회 실행하고 나면 다시 쓸 일이 없어서** 정식 버전에서 분리해 두었습니다.
> 다 쓰고 나면 v1.1.0으로 돌아가도 됩니다. 붙인 아이콘은 Booth Import Manager 유니티 패키지가 그리므로 그대로 남습니다.

### 썸네일 매칭 (BIM Thumbnail Matcher 1.0.0)

BIM을 쓰기 전에 직접 넣어둔 에셋 폴더에도 BOOTH 썸네일을 한 번에 붙이는 유니티 창입니다. 따로 설치하는 유니티 패키지예요.

1. 크롬 확장(이 버전)을 설치하고 BOOTH 라이브러리 페이지 맨 위 BIM 줄의 **🖼 썸네일 매칭용 목록 저장**을 누릅니다. (관리 페이지 → 설정에도 있음)
   - 구매·선물 목록(상품 이름, 샵, 썸네일 주소, 파일 이름)을 `다운로드\BoothImportManager\_bim\library.json`에 저장합니다. 외부로 보내지 않습니다.
2. 유니티에서 `Tools > Booth Import Manager > 썸네일 매칭 (설치된 에셋)` → **③ 스캔해서 대조하기**
   - **원본 파일 대조**: 보관·다운로드 폴더에 남아 있는 zip/unitypackage 안의 GUID로 정확히 찾기 (폴더를 옮겼어도 OK). 처음 한 번은 파일을 읽느라 시간이 걸리고, 다음부터는 기억해 둔 결과를 씁니다.
   - **이름 대조**: 분류 폴더(`01.헤어` 등)는 건너뛰고 샵 폴더 → 그 샵의 상품 순으로 비교. 아바타별 하위 폴더(`Airi`, `Shinano` …)는 건너뜁니다.
3. 결과 탭: **자동 매칭** / **확인 필요**(후보 카드에서 고르기) / **못 찾음**(직접 찾기·분류 폴더 지정·숨기기) / **이미 있음**(아이콘 지우기)
4. **선택한 N개에 썸네일 붙이기** → 상품 폴더에 상품 썸네일, 샵 폴더에 샵 프로필 사진
5. 유니티를 켜 둔 채 BOOTH 라이브러리를 열면, 썸네일을 붙인 상품이 그 프로젝트 **임포트됨**으로 표시됩니다.
   - 크롬 확장이 유니티에서 "썸네일 아이콘이 붙은 상품 폴더" 목록을 받아와 반영합니다. (BIM으로 임포트한 상품도 마찬가지)
   - 아이콘을 지우면 표시도 사라지고, v1.1.0 확장으로 돌아가도 표시는 남습니다.

### 설치

- **크롬 확장**: 아래 zip을 풀어 기존 폴더에 덮어쓰고 `chrome://extensions`에서 ↻ (확장 화면에는 버전이 `1.1.0-1`로 표시됩니다)
- **유니티**: ALCOM/VCC에서 Booth Import Manager 1.1.0 + **BIM Thumbnail Matcher** 추가
  - 직접 넣으려면 아래 두 unitypackage를 임포트 (Thumbnail Matcher는 Booth Import Manager 1.1.0 이상이 있어야 동작)
- 다 쓰고 나면: 유니티에서 BIM Thumbnail Matcher를 지우고, 크롬 확장은 v1.1.0으로 바꿔도 됩니다.

### 받을 파일

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v1.1.0-1.zip` | 크롬 확장 (썸네일 매칭용 목록 저장 포함) |
| `BoothImportManager-Unity-v1.1.0-1.unitypackage` | Booth Import Manager 유니티 패키지 (v1.1.0과 같음) |
| `BoothThumbnailMatcher-Unity-v1.0.0.unitypackage` | 썸네일 매칭 유니티 패키지 |
| `local.booth-import-manager-1.1.0-1.zip`, `local.booth-thumbnail-matcher-1.0.0.zip` | ALCOM/VCC(VPM)용 |
