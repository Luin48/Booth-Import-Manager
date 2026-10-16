# 릴리즈 체크리스트

1. 세 곳의 버전이 같은지 (`manifest.json`, `package.json`, `BimContext.Version`)
2. `python scripts/make_vpm.py index` 후 `vpm/index.json` 커밋
3. 크롬에서 확장 ↻ → 라이브러리 페이지에서 [Unity로] → 유니티 임포트까지 확인
4. 프로젝트 없음(다운로드 폴더로 받기) 확인
5. 유니티를 끈 상태에서 보낸 파일이 켰을 때 임포트되는지 확인
6. `docs/release-notes-v<버전>.md` 작성 후 Actions에서 릴리즈
