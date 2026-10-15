# Chrome Extension Setup (v0.3)

1. `chrome://extensions` 열기 → 개발자 모드 켜기
2. *압축해제된 확장 프로그램 로드* → 이 저장소의 `chrome_extension` 폴더 선택
3. v0.2 "Booth Import Manager Bridge" 확장이 있다면 제거
4. 툴바의 확장 아이콘(고정 추천) → 사이드패널 → 관리

권한 설명
- `downloads`: Unity로 버튼 다운로드 시작 / 완료 감지
- `scripting`, `tabs`: 찜 정리 시 booth 탭에서 부스 API 호출 (로그인 세션 그대로 사용)
- `storage`: 마지막으로 고른 프로젝트·태그, 찜 정리 규칙
- `sidePanel`: 사이드패널
- 호스트: `booth.pm`, `*.booth.pm`, `127.0.0.1`(로컬 앱)
