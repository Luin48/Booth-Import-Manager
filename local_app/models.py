from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


SUPPORTED_SUFFIXES = {".unitypackage", ".zip", ".7z", ".rar"}


@dataclass
class LocalAsset:
    id: str
    filename: str
    path: str
    size: int
    file_type: str
    tag: str = ""

    @classmethod
    def from_path(cls, path: Path, tag: str = "", asset_id: str | None = None) -> "LocalAsset":
        suffix = path.suffix.lower()
        file_type = "unitypackage" if suffix == ".unitypackage" else suffix.lstrip(".") if suffix in SUPPORTED_SUFFIXES else "other"
        display_name = asset_id or path.name
        return cls(
            id=display_name,
            filename=display_name,
            path=str(path),
            size=path.stat().st_size,
            file_type=file_type,
            tag=tag,
        )
