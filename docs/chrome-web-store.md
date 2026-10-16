# 크롬 웹스토어 등록 자료 (v1.0.0)

[Chrome 웹스토어 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에 그대로 옮겨 넣을 내용입니다.

---

## 0. 등록 전에 준비할 것

- [ ] 웹스토어 개발자 계정 등록 (처음 한 번 등록비 5달러, 구글 계정에 2단계 인증 필요)
- [ ] 개발자 계정의 **연락처 이메일 인증**
- [ ] 판매자(트레이더) 여부 선언 → 무료 개인 프로젝트이므로 **트레이더 아님(Non-trader)** 선택
- [ ] 업로드할 zip: `BoothImportManager-ChromeExtension-v1.0.0.zip` (GitHub 릴리즈, 또는 `chrome_extension` 폴더 안의 파일을 manifest.json 이 맨 위에 오게 압축)

## 1. 패키지

| 항목 | 값 |
| --- | --- |
| 업로드 파일 | `BoothImportManager-ChromeExtension-v1.0.0.zip` |
| 이름 (manifest) | Booth Import Manager |
| 버전 | 1.0.0 |
| 요약 (manifest description, 132자 이내) | BOOTH에서 산 에셋을 클릭 한 번으로 Unity 프로젝트에 임포트하고 태그 폴더로 정리합니다. 찜목록 정리와 다크 테마 포함. |

## 2. 스토어 등록정보 (Store listing)

| 항목 | 값 |
| --- | --- |
| 언어 | 한국어 (영어·일본어 설명은 "현지화"에 추가) |
| 카테고리 | 생산성 → 개발자 도구 (Developer Tools) |
| 스토어 아이콘 | `store/icon-128.png` (128×128, 96px 그림 + 16px 여백) |
| 스크린샷 | `store/screenshot-1.png` ~ `screenshot-5.png` (1280×800, 5장) |
| 작은 홍보 타일 | `store/promo-small-440x280.png` |
| 마키 홍보 타일 (선택) | `store/promo-marquee-1400x560.png` |
| 홈페이지 URL | https://github.com/Luin48/Booth-Import-Manager |
| 지원 URL | https://github.com/Luin48/Booth-Import-Manager/issues |
| 성인 콘텐츠 | 아니요 |

> 스크린샷은 실제 확장을 가상의 상품·샵으로 채운 시연용 페이지에서 찍었습니다. (실제 구매 목록이나 다른 사람의 상품 이미지가 노출되지 않음)

### 상세 설명 — 한국어 (기본)

```text
BOOTH(booth.pm)에서 산 VRChat·유니티 에셋을 클릭 한 번으로 원하는 Unity 프로젝트에 임포트합니다.

■ 이런 걸 해줘요
• BOOTH 라이브러리·주문 페이지의 파일마다 [▶ Unity로] 버튼
• 상품마다 프로젝트와 태그를 고르면 다운로드 → zip 압축 해제 → 임포트 → 태그 폴더 정리까지 자동
• 여러 유니티 프로젝트 지원: ALCOM / VCC 프로젝트 폴더를 등록하면 자동으로 찾아요
• 유니티가 꺼져 있어도 예약: 대기열에 쌓였다가 그 프로젝트를 켜는 순간 임포트
• 실행 상태 표시(🟢/🔴), 프로젝트별 임포트 위치, 프로젝트별 태그, 태그 세트
• 임포트한 폴더 아이콘을 상품 썸네일·샵 프로필 사진으로 표시
• 라이브러리에 "어느 프로젝트에 넣었는지" 배지, 페이지당 상품 수(10~50), 다운로드 항목 접기
• 에셋 프리셋: 자주 쓰는 에셋 묶음(파일 + 태그)을 기록해 두고 새 프로젝트에 한 번에 넣기, 상품 업데이트 표시
• 찜목록 정리: 이미 산 상품을 풀팩 구매 / 일부 구매 / 구매로 나눠 찜 리스트에 분류하거나 찜 해제
• 글자가 잘 읽히는 BOOTH 다크 테마

■ 필요한 것
이 확장은 Unity 에디터용 패키지 "Booth Import Manager"와 함께 동작합니다.
ALCOM 또는 VCC에 아래 저장소를 추가한 뒤 프로젝트에 패키지를 추가하세요.
https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json
사용 설명서: https://github.com/Luin48/Booth-Import-Manager

■ 개인정보
설정과 기록은 내 PC의 크롬 저장소에만 저장되고, 개발자나 제3자에게 보내지 않습니다.
확장은 BOOTH와, 같은 PC에서 켜져 있는 유니티 에디터(127.0.0.1)하고만 통신합니다.

※ pixiv / BOOTH의 공식 도구가 아닌 개인 제작 확장입니다.
```

### 상세 설명 — English (현지화)

```text
Import assets you bought on BOOTH (booth.pm) into the Unity project of your choice with one click.

■ Features
• A [▶ Unity로] button on every file in your BOOTH library and order pages
• Pick a project and a tag per item — download → unzip → import → organize into tag folders, all automatic
• Multiple Unity projects: register your ALCOM / VCC project folder and projects are detected automatically
• Works even when Unity is closed: files wait in a queue and import the moment you open that project
• Live running status (🟢/🔴), per-project import folder, per-project tags and tag sets
• Imported folders get the product thumbnail / shop avatar as their folder icon
• Badges showing where each file went, items per page (10–50), collapsible download lists
• Wishlist cleanup: sort purchased items into "full set / partial / purchased" lists or remove them
• A readable dark theme for BOOTH

■ Requirements
Works together with the "Booth Import Manager" Unity Editor package.
Add this repository to ALCOM or VCC, then add the package to your project:
https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json
Manual (Korean): https://github.com/Luin48/Booth-Import-Manager

■ Privacy
Settings and history stay in Chrome storage on your computer and are never sent to the developer or third parties.
The extension only talks to BOOTH and to the Unity Editor running on the same computer (127.0.0.1).

The interface is in Korean.
This is an independent project and is not affiliated with pixiv Inc. or BOOTH.
```

### 상세 설명 — 日本語 (현지화)

```text
BOOTH（booth.pm）で購入したアセットを、ワンクリックで好きな Unity プロジェクトにインポートします。

■ できること
• BOOTH のライブラリ・注文詳細ページの各ファイルに［▶ Unity로］ボタン
• 商品ごとにプロジェクトとタグを選ぶだけで、ダウンロード → zip 展開 → インポート → タグフォルダ整理まで自動
• 複数の Unity プロジェクトに対応：ALCOM / VCC のプロジェクトフォルダを登録すると自動で検出
• Unity を閉じていても予約可能：キューで待機し、そのプロジェクトを開いた瞬間にインポート
• 起動状態の表示（🟢/🔴）、プロジェクトごとのインポート先・タグ・タグセット
• インポートしたフォルダのアイコンを商品サムネイル／ショップアイコンで表示
• ライブラリに「どのプロジェクトに入れたか」のバッジ、1ページの表示件数（10〜50）、ダウンロード項目の折りたたみ
• ほしい物リスト整理：購入済み商品を「フルセット購入／一部購入／購入」に分類、または削除
• 文字が読みやすい BOOTH ダークテーマ

■ 必要なもの
Unity エディタ用パッケージ「Booth Import Manager」と一緒に動作します。
ALCOM または VCC に次のリポジトリを追加してから、プロジェクトにパッケージを追加してください。
https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json

■ プライバシー
設定と履歴は PC 内の Chrome ストレージにのみ保存され、開発者や第三者には送信されません。
通信先は BOOTH と、同じ PC で起動中の Unity エディタ（127.0.0.1）だけです。

※ 画面は韓国語です。
※ pixiv / BOOTH の公式ツールではありません。
```

## 3. 개인정보 보호 관행 (Privacy practices)

### 단일 목적 (Single purpose)

```text
BOOTH(booth.pm)에서 구매한 에셋 관리를 돕습니다. 구매한 파일을 사용자가 고른 Unity 프로젝트·태그로 보내 임포트하고, 같은 BOOTH 화면에서 구매 목록과 찜목록 정리, 읽기 편한 화면(다크 테마)을 제공합니다.
```

English (필요하면):

```text
Helps users manage assets purchased on BOOTH (booth.pm): send purchased files to a Unity project and tag folder of their choice for import, and organize the purchase list and wishlist on BOOTH pages with a readable display (dark theme).
```

### 권한별 사유 (Permission justification)

| 권한 | 사유 (그대로 붙여넣기) |
| --- | --- |
| `downloads` | 사용자가 [Unity로]를 누른 BOOTH 파일을 크롬 다운로드 폴더 안의 대기열 폴더(BoothImportManager\대기열)에 저장하고, 같은 폴더에 작업 정보 파일(job.json)을 저장하며, 사용자가 대기열에서 취소하면 그 파일을 지우는 데 사용합니다. 부스의 원래 Download 버튼으로 받는 파일은 위치를 바꾸지 않습니다. |
| `storage` | 태그·태그 세트·프로젝트별 설정, 보낸 기록(어느 프로젝트로 보냈는지), 마지막 선택값, 다크 테마용 변환 스타일 캐시를 사용자 PC에 저장합니다. |
| `sidePanel` | BOOTH 페이지에서 보낸 기록·대기열·찜 정리 화면을 사이드패널로 보여줍니다. BOOTH 탭에서만 켜집니다. |
| `scripting` | 사용자가 '찜 정리'를 실행했을 때 BOOTH 탭 안에서 BOOTH 페이지와 같은 출처로 찜 리스트 조회·분류 요청을 보내기 위해 사용합니다. |
| 호스트 `https://booth.pm/*`, `https://*.booth.pm/*` | BOOTH 라이브러리·주문·상품 페이지에 버튼과 상태 배지를 붙이고, 상품 정보(JSON)를 읽고, 다크 테마를 적용합니다. |
| 호스트 `http://127.0.0.1/*` | 같은 PC에서 켜져 있는 Unity 에디터의 Booth Import Manager 패키지(포트 7840~7849)와 통신해서 실행 상태, 프로젝트 목록, 임포트 결과를 확인합니다. 외부로 나가지 않습니다. |

### 원격 코드 (Remote code)

**아니요, 원격 코드를 사용하지 않습니다.**
(다크 테마는 BOOTH의 CSS 파일을 *데이터로* 읽어 색만 바꿉니다. 외부 스크립트를 불러오거나 실행하지 않습니다.)

### 데이터 사용 (Data usage)

수집하는 데이터 유형 — 아래 하나만 체크:

- [x] **웹사이트 콘텐츠** — BOOTH 페이지의 상품 번호·이름·샵 이름·파일 이름 (사용자 PC에만 저장)
- 나머지(개인 식별 정보, 건강, 금융·결제, 인증 정보, 개인 통신, 위치, 웹 기록, 사용자 활동)는 체크하지 않음

인증 3개 모두 체크:

- [x] 승인된 사용 사례 외의 목적으로 제3자에게 사용자 데이터를 판매하거나 전송하지 않습니다
- [x] 항목의 단일 목적과 관련 없는 목적으로 사용자 데이터를 사용하거나 전송하지 않습니다
- [x] 신용도 판단이나 대출 목적으로 사용자 데이터를 사용하거나 전송하지 않습니다

### 개인정보처리방침 URL

```text
https://github.com/Luin48/Booth-Import-Manager/blob/main/PRIVACY.md
```

## 4. 배포

| 항목 | 추천 |
| --- | --- |
| 공개 범위 | 공개 (처음엔 "일부 공개(Unlisted)"로 올려 링크로만 받게 하고, 문제 없으면 공개로 바꿔도 됨) |
| 지역 | 모든 지역 |

## 5. 심사에서 걸릴 수 있는 점

- **이름에 들어간 "BOOTH"(pixiv 상표)**: 설명 끝에 "공식 도구가 아님"을 넣었습니다. 그래도 상표 문제로 반려되면 이름을 `BIM – Unity Importer for BOOTH`처럼 "for BOOTH" 형태로 바꾸면 됩니다.
- **단일 목적**: 임포트·찜 정리·다크 테마가 모두 "BOOTH 구매 에셋 관리"라는 한 가지 목적이라고 설명해 두었습니다. 반려 사유가 이것이면 다크 테마를 따로 떼는 방법이 있습니다.
- **유니티 패키지가 필요함**: 확장만 설치하면 [Unity로]가 대기열에 쌓이기만 합니다. 설명에 유니티 패키지 저장소 주소를 넣어 두었습니다.
- **로그인 필요**: 기능 대부분이 BOOTH 로그인 후 라이브러리에서 보입니다. 심사 메모를 쓸 수 있으면 "BOOTH 계정으로 로그인 후 https://accounts.booth.pm/library 에서 확인"이라고 적어 주세요.

## 6. 업데이트할 때

1. `chrome_extension/manifest.json` 버전 올리기 (유니티 패키지 버전과 맞추기 — `docs/build.md`)
2. GitHub Actions로 릴리즈 → 생긴 `BoothImportManager-ChromeExtension-v<버전>.zip`을 대시보드 **패키지 → 새 패키지 업로드**
