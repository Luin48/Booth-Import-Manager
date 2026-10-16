# 개인정보처리방침 / Privacy Policy — Booth Import Manager

시행일 / Effective date: 2026-10-16

## 한국어

Booth Import Manager(이하 "확장")는 개인이 만든 크롬 확장 프로그램입니다. 확장은 **어떤 개인정보도 개발자나 제3자에게 보내지 않습니다.**

### 확장이 다루는 정보

| 정보 | 어디에 쓰나 | 어디에 저장되나 |
| --- | --- | --- |
| BOOTH 라이브러리·주문 페이지의 상품 정보 (상품 번호, 이름, 샵 이름, 썸네일 주소, 파일 이름) | 받은 파일을 어느 유니티 프로젝트·태그로 보냈는지 기록하고 페이지에 상태를 표시 | 사용자 PC의 크롬 확장 저장소 (`chrome.storage.local`) |
| 태그, 태그 세트, 프로젝트 폴더 경로, 프로젝트별 설정 | 확장 기능 설정 | 같은 곳 |
| 다운로드한 파일 | 사용자가 [Unity로]를 누른 파일을 크롬 다운로드 폴더 안의 대기열 폴더에 저장 | 사용자 PC |
| BOOTH 라이브러리 목록 (상품 번호·이름, 샵 이름, 썸네일 주소, 파일 이름) | 사용자가 '썸네일 매칭용 목록 저장'을 누를 때만, 같은 PC의 유니티 썸네일 매칭 창이 읽도록 파일로 저장 | 사용자 PC (`다운로드\BoothImportManager\_bim\library.json`) |
| 찜목록 | 사용자가 '찜 정리'를 실행할 때만, 사용자의 BOOTH 로그인 상태로 BOOTH에 직접 요청해 리스트를 분류하거나 찜을 해제 | BOOTH (사용자 계정) |

### 통신

- **booth.pm / \*.booth.pm**: 버튼 표시, 상품 정보 조회, 다크 테마용 스타일시트 읽기, 찜 정리. 사용자의 BOOTH 로그인 세션을 그대로 씁니다.
- **127.0.0.1 (내 PC)**: 같은 PC에서 켜져 있는 유니티 에디터(Booth Import Manager 유니티 패키지)와 통신합니다. 인터넷으로 나가지 않습니다.
- 그 밖의 서버(분석, 광고, 개발자 서버 등)로는 아무것도 보내지 않습니다.

### 보관과 삭제

모든 기록은 사용자 PC에만 있습니다. 확장을 삭제하면 크롬 확장 저장소의 기록도 함께 지워집니다. 사이드패널의 **기록 삭제**로 언제든 지울 수 있습니다.

### 문의

<https://github.com/Luin48/Booth-Import-Manager/issues>

---

## English

Booth Import Manager (the "extension") is an independent, personal project. **It does not send any personal data to the developer or to any third party.**

### Data the extension handles

| Data | Purpose | Where it is stored |
| --- | --- | --- |
| Product information from BOOTH library / order pages (item ID, name, shop name, thumbnail URL, file name) | Remember which Unity project and tag each file was sent to, and show status badges | Locally, in Chrome extension storage (`chrome.storage.local`) |
| Tags, tag sets, project folder paths, per-project settings | Extension settings | Same as above |
| Downloaded files | Files the user sends with "Unity로" are saved into a queue folder inside the Chrome downloads folder | The user's computer |
| BOOTH library list (item ID and name, shop name, thumbnail URL, file names) | Only when the user clicks "Save list for thumbnail matching", saved as a file for the Unity thumbnail matcher window on the same computer | The user's computer (`Downloads\BoothImportManager\_bim\library.json`) |
| Wishlist | Only when the user runs "Wishlist cleanup", requests are sent directly to BOOTH with the user's own BOOTH session to sort or remove wishlist items | BOOTH (the user's account) |

### Network access

- **booth.pm / \*.booth.pm** — page buttons, item info, reading stylesheets for the dark theme, wishlist cleanup. Uses the user's existing BOOTH session.
- **127.0.0.1 (this computer)** — talks to the companion Unity Editor package running on the same computer. Nothing leaves the computer.
- No analytics, advertising, or developer servers are contacted.

### Retention and deletion

All data stays on the user's computer. Uninstalling the extension removes its storage. History can be cleared at any time from the side panel.

### Contact

<https://github.com/Luin48/Booth-Import-Manager/issues>

This extension is not affiliated with, endorsed by, or sponsored by pixiv Inc. or BOOTH.
