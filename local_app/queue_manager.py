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


def _copy_package(package: Path, tag: str) -> Path:
    cfg = get_config()
    queue_dir = Path(cfg.queue_folder) / sanitize_folder_name(tag)
    queue_dir.mkdir(parents=True, exist_ok=True)
    target = unique_path(queue_dir / package.name)
    shutil.copy2(package, target)
    return target


def _packages_from_zip(path: Path) -> tuple[list[Path], Path]:
    extract_dir = unique_path(path.with_suffix(""))
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "r") as archive:
        archive.extractall(extract_dir)
    return list(extract_dir.rglob("*.unitypackage")), extract_dir


def queue_for_unity(filename: str, tag: str, delete_local: bool = False) -> dict:
    cfg = get_config()
    source = Path(cfg.intake_folder) / Path(filename).name
    if not source.exists() or source.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise FileNotFoundError(f"Local file not found: {source}")

    queued: list[Path] = []
    extracted: list[Path] = []
    if source.suffix.lower() == ".unitypackage":
        queued.append(_copy_package(source, tag))
    elif source.suffix.lower() == ".zip":
        packages, extract_dir = _packages_from_zip(source)
        extracted.append(extract_dir)
        for package in packages:
            queued.append(_copy_package(package, tag))

    if delete_local or cfg.delete_local_after_queue:
        source.unlink(missing_ok=True)
        for path in extracted:
            shutil.rmtree(path, ignore_errors=True)

    return {
        "filename": source.name,
        "tag": tag,
        "queued": [str(path) for path in queued],
        "extracted": [str(path) for path in extracted],
        "status": "queued" if queued else "no_package",
    }
