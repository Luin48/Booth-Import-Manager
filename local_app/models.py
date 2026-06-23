from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


SUPPORTED_SUFFIXES = {".zip", ".unitypackage"}


@dataclass
class LocalAsset:
    id: str
    filename: str
    path: str
    size: int
    file_type: str
    tag: str = ""

    @classmethod
    def from_path(cls, path: Path, tag: str = "") -> "LocalAsset":
        suffix = path.suffix.lower()
        file_type = "unitypackage" if suffix == ".unitypackage" else "zip" if suffix == ".zip" else "other"
        return cls(
            id=path.name,
            filename=path.name,
            path=str(path),
            size=path.stat().st_size,
            file_type=file_type,
            tag=tag,
        )
