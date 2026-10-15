from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from config import get_config
from file_mover import unique_path
from models import SUPPORTED_SUFFIXES


def sanitize_folder_name(name: str) -> str:
    invalid = '<>:"/\\|?*'
    cleaned = "".join("_" if ch in invalid else ch for ch in name).strip()
    return cleaned or "미분류"


def _copy_package(package: Path, tag: str, project_key: str = "") -> Path:
    cfg = get_config()
    base = Path(cfg.projects_queue_root) / project_key if project_key else Path(cfg.queue_folder)
    queue_dir = base / sanitize_folder_name(tag)
    queue_dir.mkdir(parents=True, exist_ok=True)
    target = unique_path(queue_dir / package.name)
    shutil.copy2(package, target)
    return target


MARKER = ".bim_extracted"


def _decode_name(info: zipfile.ZipInfo) -> str:
    # 일본 부스 zip 은 UTF-8 플래그 없이 Shift_JIS 이름인 경우가 많다
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode("cp437", errors="replace")
    for enc in ("utf-8", "cp932", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return info.filename


def _packages_from_zip(path: Path) -> tuple[list[Path], Path]:
    signature = f"{path.stat().st_size}:{int(path.stat().st_mtime)}"
    preferred = path.with_suffix("")
    # 같은 zip 을 다른 프로젝트로 또 보낼 때는 이미 풀어둔 폴더 재사용
    if (preferred / MARKER).exists():
        try:
            if (preferred / MARKER).read_text(encoding="utf-8") == signature:
                return list(preferred.rglob("*.unitypackage")), preferred
        except OSError:
            pass
    extract_dir = unique_path(preferred)
    extract_dir.mkdir(parents=True, exist_ok=True)
    root = extract_dir.resolve()
    with zipfile.ZipFile(path, "r") as archive:
        for info in archive.infolist():
            name = _decode_name(info).replace("\\", "/")
            target = (extract_dir / name).resolve()
            if not str(target).startswith(str(root)):
                continue  # zip slip 방지
            if info.is_dir() or name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
    (extract_dir / MARKER).write_text(signature, encoding="utf-8")
    return list(extract_dir.rglob("*.unitypackage")), extract_dir


def queue_for_unity(filename: str, tag: str, delete_local: bool = False, project_key: str = "") -> dict:
    cfg = get_config()
    source = Path(cfg.intake_folder) / Path(filename).name
    if not source.exists() or source.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise FileNotFoundError(f"Local file not found: {source}")

    queued: list[Path] = []
    extracted: list[Path] = []
    if source.suffix.lower() == ".unitypackage":
        queued.append(_copy_package(source, tag, project_key))
    elif source.suffix.lower() == ".zip":
        packages, extract_dir = _packages_from_zip(source)
        extracted.append(extract_dir)
        for package in packages:
            queued.append(_copy_package(package, tag, project_key))

    if delete_local or cfg.delete_local_after_queue:
        source.unlink(missing_ok=True)
        for path in extracted:
            shutil.rmtree(path, ignore_errors=True)

    return {
        "filename": source.name,
        "tag": tag,
        "project": project_key,
        "queued": [str(path) for path in queued],
        "extracted": [str(path) for path in extracted],
        "status": "queued" if queued else "no_package",
    }
