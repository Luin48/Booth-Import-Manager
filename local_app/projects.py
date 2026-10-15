"""유니티 프로젝트 인식 / 상태 / 패키지 설치.

프로젝트 키 = FNV-1a 32bit(정규화 경로) 8자리 hex + "_" + 폴더명
유니티 패키지(BoothProjectKey.cs)도 같은 방식으로 계산해서 자기 큐 폴더를 찾는다.
정규화: 절대경로, 역슬래시→슬래시, 끝 슬래시 제거, 소문자.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
from pathlib import Path

from config import RESOURCE_DIR, get_config


HEARTBEAT_NAME = ".heartbeat.json"
HEARTBEAT_FRESH_SEC = 45
PACKAGE_NAME = "local.booth-import-manager"


# ---- 키 ---------------------------------------------------------------------
def normalize_path(path: str) -> str:
    p = os.path.abspath(path).replace("\\", "/").rstrip("/")
    return p.lower()


def fnv1a32(text: str) -> int:
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def safe_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip().rstrip(".")
    return cleaned[:40] or "project"


def project_key(path: str) -> str:
    return f"{fnv1a32(normalize_path(path)):08x}_{safe_name(Path(path).name)}"


# ---- 감지 -------------------------------------------------------------------
def is_unity_project(path: Path) -> bool:
    return (path / "Assets").is_dir() and (path / "ProjectSettings").is_dir()


def unity_version(path: Path) -> str:
    try:
        text = (path / "ProjectSettings" / "ProjectVersion.txt").read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"m_EditorVersion:\s*(\S+)", text)
        return m.group(1) if m else ""
    except OSError:
        return ""


def scan_root(root: str, depth: int = 2) -> list[Path]:
    base = Path(root)
    if not base.is_dir():
        return []
    if is_unity_project(base):
        return [base]
    found: list[Path] = []
    try:
        children = sorted([c for c in base.iterdir() if c.is_dir() and not c.name.startswith((".", "_"))], key=lambda c: c.name.lower())
    except OSError:
        return []
    for child in children:
        if is_unity_project(child):
            found.append(child)
        elif depth > 1:
            found.extend(scan_root(str(child), depth - 1))
    return found


def suggest_roots() -> list[dict]:
    """ALCOM / VCC 기본 위치 후보."""
    home = Path.home()
    out: list[dict] = []

    def add(path: Path, source: str) -> None:
        if path.is_dir() and not any(normalize_path(str(path)) == normalize_path(o["path"]) for o in out):
            out.append({"path": str(path), "source": source, "count": len(scan_root(str(path)))})

    add(home / "ALCOM" / "Projects", "ALCOM 기본 폴더")
    local = os.environ.get("LOCALAPPDATA")
    if local:
        vcc = Path(local) / "VRChatCreatorCompanion" / "settings.json"
        try:
            data = json.loads(vcc.read_text(encoding="utf-8-sig"))
            for key in ("defaultProjectPath", "projectBackupPath"):
                if key == "defaultProjectPath" and data.get(key):
                    add(Path(data[key]), "VCC 기본 프로젝트 폴더")
            parents: dict[str, int] = {}
            for p in data.get("userProjects", []) or []:
                parent = str(Path(p).parent)
                parents[parent] = parents.get(parent, 0) + 1
            for parent, _ in sorted(parents.items(), key=lambda kv: -kv[1]):
                add(Path(parent), "VCC 등록 프로젝트 위치")
        except (OSError, ValueError):
            pass
        add(Path(local) / "VRChatProjects", "VCC 기본 폴더")
    add(home / "Documents" / "VRChatProjects", "문서/VRChatProjects")
    return out


# ---- 상태 -------------------------------------------------------------------
def queue_dir(key: str) -> Path:
    return Path(get_config().projects_queue_root) / key


def read_heartbeat(key: str) -> dict:
    try:
        return json.loads((queue_dir(key) / HEARTBEAT_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def unity_running(path: Path, heartbeat: dict) -> bool:
    if heartbeat and time.time() - float(heartbeat.get("time", 0)) < HEARTBEAT_FRESH_SEC:
        return True
    lock = path / "Temp" / "UnityLockfile"
    if not lock.exists():
        return False
    # 유니티가 열고 있으면 윈도우에서는 쓰기 열기가 막힌다
    try:
        with open(lock, "a"):
            pass
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def find_installed(path: Path) -> str:
    """'packages' | 'assets:<상대경로>' | ''"""
    if (path / "Packages" / PACKAGE_NAME / "package.json").exists():
        return "packages"
    assets = path / "Assets"
    try:
        for hit in assets.rglob("BoothQueueWatcher.cs"):
            return "assets:" + str(hit.parent.relative_to(path)).replace("\\", "/")
    except OSError:
        pass
    return ""


def pending_files(key: str) -> list[dict]:
    root = queue_dir(key)
    if not root.is_dir():
        return []
    out = []
    files = sorted(list(root.rglob("*.unitypackage")) + list(root.rglob("*.unitypackage.failed")))
    for f in files:
        failed = f.name.endswith(".failed")
        try:
            out.append({
                "path": str(f),
                "failed": failed,
                "name": f.name.removesuffix(".failed"),
                "tag": f.parent.name,
                "size": f.stat().st_size,
                "queuedAt": int(f.stat().st_mtime),
            })
        except OSError:
            continue
    return out


def _all_project_paths() -> list[Path]:
    cfg = get_config()
    seen: set[str] = set()
    out: list[Path] = []
    for root in cfg.project_roots:
        for p in scan_root(root):
            n = normalize_path(str(p))
            if n not in seen:
                seen.add(n)
                out.append(p)
    for extra in cfg.extra_projects:
        p = Path(extra)
        n = normalize_path(extra)
        if n not in seen and is_unity_project(p):
            seen.add(n)
            out.append(p)
    return out


def _heartbeat_keys() -> dict[str, str]:
    """유니티가 남긴 하트비트로 경로→키 매핑 (키 계산이 어긋나도 유니티 쪽 키를 따른다)."""
    out: dict[str, str] = {}
    root = Path(get_config().projects_queue_root)
    if not root.is_dir():
        return out
    for hb_file in root.glob(f"*/{HEARTBEAT_NAME}"):
        try:
            hb = json.loads(hb_file.read_text(encoding="utf-8"))
            if hb.get("projectPath"):
                out[normalize_path(hb["projectPath"])] = hb_file.parent.name
        except (OSError, ValueError):
            continue
    return out


def key_for_path(path: str, hb_keys: dict[str, str] | None = None) -> str:
    hb_keys = _heartbeat_keys() if hb_keys is None else hb_keys
    return hb_keys.get(normalize_path(path)) or project_key(path)


def list_projects(include_hidden: bool = True, deep: bool = True) -> list[dict]:
    cfg = get_config()
    out = []
    hb_keys = _heartbeat_keys()
    for path in _all_project_paths():
        key = key_for_path(str(path), hb_keys)
        settings = cfg.projects.get(key, {})
        if settings.get("hidden") and not include_hidden:
            continue
        hb = read_heartbeat(key)
        item = {
            "key": key,
            "name": settings.get("alias") or path.name,
            "folderName": path.name,
            "path": str(path),
            "unityVersion": unity_version(path),
            "tags": settings.get("tags"),  # None = 아직 할당 안 함(전체 사용)
            "assetRoot": settings.get("assetRoot", "Assets"),
            "hidden": bool(settings.get("hidden")),
            "running": unity_running(path, hb),
            "pending": len([f for f in pending_files(key) if not f["failed"]]),
            "failed": len([f for f in pending_files(key) if f["failed"]]),
            "packageVersion": hb.get("version", ""),
            "lastSeen": int(float(hb.get("time", 0))) if hb else 0,
        }
        if deep:
            item["installed"] = find_installed(path)
        out.append(item)
    return out


def get_project(key: str) -> dict | None:
    for p in list_projects(deep=False):
        if p["key"] == key:
            return p
    return None


def write_project_file(key: str, project: dict) -> None:
    """큐 폴더에 프로젝트 설정을 남겨 유니티가 asset root 를 읽게 한다."""
    d = queue_dir(key)
    d.mkdir(parents=True, exist_ok=True)
    (d / "project.json").write_text(json.dumps({
        "projectPath": project["path"],
        "name": project["name"],
        "assetRoot": project.get("assetRoot") or "Assets",
    }, ensure_ascii=False, indent=2), encoding="utf-8")


# ---- 패키지 설치 -------------------------------------------------------------
def package_source() -> Path:
    return RESOURCE_DIR / "unity_package" / "BoothImportManager"


def install_package(path: str) -> dict:
    project = Path(path)
    if not is_unity_project(project):
        raise FileNotFoundError("유니티 프로젝트가 아니에요")
    src = package_source()
    if not src.is_dir():
        raise FileNotFoundError(f"패키지 원본이 없어요: {src}")

    installed = find_installed(project)
    if installed.startswith("assets:"):
        # 예전 방식(Assets 안에 복사)으로 이미 있으면 그 자리를 갱신 — 두 벌이면 컴파일 에러가 나므로
        target = project / installed.removeprefix("assets:")
        editor_src = src / "Editor"
        for f in editor_src.iterdir():
            if f.suffix in (".cs", ".asmdef"):
                shutil.copy2(f, target / f.name)
        return {"mode": "updated-in-assets", "path": str(target)}

    target = project / "Packages" / PACKAGE_NAME
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(src, target, ignore=shutil.ignore_patterns("*.meta"))
    return {"mode": "packages", "path": str(target)}
