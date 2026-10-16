# 크롬 확장 설치 (v0.4)

1. `chrome://extensions` 열기 → 개발자 모드 켜기
2. *압축해제된 확장 프로그램 로드* → `chrome_extension` 폴더 선택
3. 툴바의 확장 아이콘(고정 추천) → 사이드패널 → 관리

권한 설명
- `downloads`: [Unity로] 파일을 다운로드 폴더 안의 대기열에 저장, 작업 정보(job.json) 저장
- `scripting`, `tabs`: 찜 정리 시 부스 탭에서 부스 API 호출 (로그인 세션 그대로 사용)
- `storage`: 태그·프로젝트 설정, 보낸 기록, 마지막 선택값
- `sidePanel`: 사이드패널
- 호스트: `booth.pm`, `*.booth.pm`, `127.0.0.1` (켜진 유니티의 BIM 패키지, 포트 7840~7849)
