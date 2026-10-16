## Booth Import Manager v1.0.0

BOOTH(booth.pm)에서 산 에셋을 클릭 한 번으로 원하는 유니티 프로젝트에 임포트하는 도구입니다.
크롬 확장과 유니티 패키지 두 개로 동작하고, 따로 실행해 둘 프로그램은 없습니다.

### 기능

- **원클릭 임포트**: BOOTH 라이브러리·주문 페이지의 파일마다 Download 버튼 왼쪽에 **▶ Unity로**. 상품마다 프로젝트와 태그를 고르면 다운로드 → zip 해제(일본어 파일 이름 포함) → 임포트 → 태그 폴더 정리까지 자동
- **여러 유니티 프로젝트**: ALCOM / VCC 프로젝트 폴더를 등록하면 자동으로 찾고, 실행 상태(🟢/🔴)를 실시간으로 표시
- **꺼져 있어도 예약**: 유니티가 꺼진 프로젝트로 보내면 대기열에 쌓였다가 그 프로젝트를 켜는 순간 임포트
- **태그 = 폴더**: 프로젝트별 임포트 위치와 쓸 태그, 태그 세트, 끌어서 순서 바꾸기
- **폴더 아이콘**: 임포트한 폴더를 상품 썸네일·샵 프로필 사진으로 표시
- **라이브러리 편의**: 어디에 넣었는지 배지, 페이지당 상품 수(10~50), 다운로드 항목 접기/펼치기
- **찜목록 정리**: 이미 산 상품을 풀팩 구매 / 일부 구매 / 구매로 분류하거나 찜 해제
- **BOOTH 다크 테마**: 글자가 잘 읽히는 다크 모드
- 사이드패널(부스 페이지에서만): 보낸 기록, 대기열 취소, 찜 정리

### 받을 파일

| 파일 | 용도 |
| --- | --- |
| `BoothImportManager-ChromeExtension-v1.0.0.zip` | 크롬 확장 |
| `BoothImportManager-Unity-v1.0.0.unitypackage` | 유니티 패키지 (직접 임포트용) |
| `local.booth-import-manager-1.0.0.zip` | ALCOM/VCC 저장소용 (직접 받을 필요 없음) |

### 설치

1. 크롬 확장 zip을 풀고 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드합니다**
2. ALCOM(또는 VCC)에 저장소 추가 → 프로젝트에 **Booth Import Manager** 패키지 추가

   ```text
   https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json
   ```

3. 크롬 설정의 "다운로드 전에 각 파일의 저장 위치 확인"은 꺼 두세요

자세한 사용법은 [README](https://github.com/Luin48/Booth-Import-Manager#readme)에 있습니다.
