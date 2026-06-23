# Booth Import Manager

Booth에서 받은 Unity 에셋 파일을 지정 폴더로 옮기고, 태그별 Unity 임포트 큐로 보내는 Windows용 도구입니다.

## 기능

- Chrome에서 완료된 `booth.pm` 다운로드만 감지
- 다운로드 완료 후 파일을 지정 폴더로 이동
- GUI에서 태그 지정, 다중 선택, 목록 숨김, 로컬 삭제
- `.zip` 안의 `.unitypackage` 자동 추출 후 Unity 큐로 복사
- Unity Editor 확장으로 큐 폴더 자동 임포트
- 같은 최상위 폴더명으로 들어온 메터리얼/프리팹 패키지 병합
- `태그 없음` 선택 시 태그 폴더 없이 설정된 최상위 폴더 바로 아래로 정리

## 폴더 구성

```text
assets/             앱 아이콘
chrome_extension/   Chrome 다운로드 완료 감지 확장
docs/               설치/빌드 문서
local_app/          로컬 서버와 파일 처리 로직
scripts/            배포 빌드 스크립트
unity_package/      Unity Editor 확장 소스
webui/              정적 GUI
```

## 빠른 실행

릴리스에서 `BoothImportManager.exe`를 받은 뒤 실행합니다.

앱 기본 주소:

```text
http://127.0.0.1:7831
```

브라우저 창 또는 탭을 닫으면 로컬 앱 서버도 같이 종료됩니다.

## 초기 설정

1. `BoothImportManager.exe` 실행
2. 브라우저에서 `http://127.0.0.1:7831` 열기
3. 좌측 `폴더` 영역 설정
   - `Chrome 다운로드 폴더`: Chrome이 파일을 내려받는 폴더
   - `이동 후 보관 폴더`: Booth 파일을 모아둘 폴더
   - `Unity 큐 폴더`: Unity가 자동 임포트할 `.unitypackage` 큐 폴더
4. `설정 저장` 클릭
5. Chrome 확장과 Unity Editor 확장 설치

`Unity 큐 폴더`는 보통 `이동 후 보관 폴더\_queue`를 사용합니다.

## Chrome 확장 설치

1. Chrome에서 `chrome://extensions` 열기
2. 개발자 모드 켜기
3. `Load unpacked`
4. 이 저장소의 `chrome_extension/` 폴더 선택

확장은 다운로드 경로나 다운로드 스트림을 바꾸지 않습니다. 완료된 `booth.pm` 다운로드를 로컬 앱에 알리기만 합니다.

## Unity 패키지 설치

Unity 프로젝트에 `unity_package/BoothImportManager` 폴더를 넣습니다.

Unity 메뉴:

```text
Tools > Booth Import Manager > Settings
```

설정:

- `Local intake folder`: 앱의 이동 후 보관 폴더
- `Asset root`: 임포트된 에셋을 정리할 Unity 최상위 폴더
- `Auto import`: 큐 폴더 자동 감지

앱에서 설정한 `Unity 큐 폴더`와 Unity의 큐 감시 경로가 같은 위치를 바라봐야 합니다.

## 사용법

1. Booth 페이지에서 파일 다운로드
2. Chrome 확장이 다운로드 완료를 감지
3. 앱이 파일을 이동 후 보관 폴더로 옮김
4. GUI에서 파일 행 클릭으로 선택
5. 태그 지정
6. `Unity 큐로 보내기` 클릭
7. Unity가 큐 폴더의 `.unitypackage`를 자동 임포트

### 태그 동작

- 일반 태그: `Assets/<Asset root>/<태그명>/` 아래로 정리
- `태그 없음`: `Assets/<Asset root>/` 바로 아래로 정리

### 상태 표시

- `임포트 안됨`: 아직 Unity 큐로 보내지 않았거나 처리 대기 중
- `임포트 완료`: Unity가 큐 파일을 처리해서 큐 파일이 사라진 상태
- `패키지 아님`: zip 안에 `.unitypackage`가 없는 상태

### 목록 관리

- `목록 지우기`: 선택 파일을 목록에서만 숨김. 로컬 파일은 유지
- `로컬 삭제`: 선택 파일을 실제로 삭제
- 앱 시작/종료 시 `임포트 완료`, `패키지 아님` 상태 항목은 자동으로 목록에서 숨김

## 개발 실행

Python 3.12 이상 권장. 외부 Python 패키지 필요 없음.

```powershell
python local_app\app.py
```

브라우저에서 `http://127.0.0.1:7831` 열기.

## 빌드

PyInstaller 필요.

```powershell
python -m pip install pyinstaller pillow
.\scripts\build-exe.ps1
```

결과:

```text
dist/BoothImportManager.exe
```

## 배포 전 주의

다음 파일/폴더는 개인 환경 값이나 빌드 산출물이므로 Git에 올리지 않습니다.

- `config.json`
- `asset_state.json`
- `tag_state.json`
- `downloads/`
- `build/`
- `dist/`
- `release/`
- `*.exe`
