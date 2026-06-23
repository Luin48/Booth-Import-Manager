from __future__ import annotations

import shutil
import time
from pathlib import Path

from config import get_config
from models import SUPPORTED_SUFFIXES


TEMP_SUFFIXES = {".crdownload", ".tmp"}


def is_supported_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES


def wait_until_stable(path: Path, timeout_sec: int = 30) -> bool:
    deadline = time.time() + timeout_sec
    last_size = -1
    stable_ticks = 0
    while time.time() < deadline:
        if not path.exists() or path.suffix.lower() in TEMP_SUFFIXES:
            time.sleep(0.5)
            continue
        try:
            size = path.stat().st_size
            with path.open("rb"):
                pass
        except OSError:
            time.sleep(0.5)
            continue
        stable_ticks = stable_ticks + 1 if size == last_size else 0
        if stable_ticks >= 2:
            return True
        last_size = size
        time.sleep(0.5)
    return False


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 1000):
        candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(f"Too many duplicate names for {path.name}")


def move_completed_booth_file(filename: str) -> Path:
    cfg = get_config()
    source = Path(cfg.download_folder) / Path(filename).name
    if not is_supported_file(source):
        raise FileNotFoundError(f"Supported downloaded file not found: {source}")
    if not wait_until_stable(source):
        raise TimeoutError(f"File did not become stable: {source}")

    intake = Path(cfg.intake_folder)
    intake.mkdir(parents=True, exist_ok=True)
    target = unique_path(intake / source.name)
    shutil.move(str(source), str(target))
    return target


def scan_intake_files() -> list[Path]:
    cfg = get_config()
    intake = Path(cfg.intake_folder)
    intake.mkdir(parents=True, exist_ok=True)
    return sorted(
        [p for p in intake.iterdir() if is_supported_file(p)],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
