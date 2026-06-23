from __future__ import annotations

import json
import sys
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path


if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
else:
    APP_DIR = Path(__file__).resolve().parent.parent
    RESOURCE_DIR = APP_DIR
CONFIG_PATH = APP_DIR / "config.json"
UNTAGGED_TAG_NAME = "태그 없음"
UNTAGGED_TAG_COLOR = "#475569"


@dataclass
class Tag:
    id: str
    name: str
    color: str = "#2563eb"


@dataclass
class AppConfig:
    download_folder: str = str(Path.home() / "Downloads")
    intake_folder: str = str(APP_DIR / "downloads")
    unity_queue_folder: str = ""
    port: int = 7831
    tags: list[Tag] = field(default_factory=lambda: [
        Tag(id=str(uuid.uuid4()), name=UNTAGGED_TAG_NAME, color=UNTAGGED_TAG_COLOR),
        Tag(id=str(uuid.uuid4()), name="의상", color="#2563eb"),
        Tag(id=str(uuid.uuid4()), name="소품", color="#059669"),
        Tag(id=str(uuid.uuid4()), name="헤어", color="#db2777"),
        Tag(id=str(uuid.uuid4()), name="기타", color="#64748b"),
    ])
    delete_local_after_queue: bool = False

    @property
    def queue_folder(self) -> str:
        return self.unity_queue_folder or str(Path(self.intake_folder) / "_queue")

    def save(self) -> None:
        ensure_special_tags(self)
        CONFIG_PATH.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls) -> "AppConfig":
        if not CONFIG_PATH.exists():
            cfg = cls()
            cfg.save()
            return cfg
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            data["tags"] = [Tag(**tag) for tag in data.get("tags", [])]
            cfg = cls(**data)
            ensure_special_tags(cfg)
            Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
            Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
            Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
            return cfg
        except Exception:
            cfg = cls()
            cfg.save()
            return cfg


def ensure_special_tags(cfg: AppConfig) -> None:
    if not any(tag.name == UNTAGGED_TAG_NAME for tag in cfg.tags):
        cfg.tags.insert(0, Tag(id=str(uuid.uuid4()), name=UNTAGGED_TAG_NAME, color=UNTAGGED_TAG_COLOR))


_config: AppConfig | None = None


def get_config() -> AppConfig:
    global _config
    if _config is None:
        _config = AppConfig.load()
    return _config


def reload_config() -> AppConfig:
    global _config
    _config = AppConfig.load()
    return _config
