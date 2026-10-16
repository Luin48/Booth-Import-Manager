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
    # v0.3: 브라우저 탭을 닫아도 서버 유지 (크롬 확장 사이드패널이 GUI 역할)
    stay_running: bool = True
    # v0.3: 받자마자 큐로 보낼지 (확장의 'Unity로' 버튼)
    auto_queue: bool = True
    # v0.3: ALCOM/VCC 프로젝트가 모여 있는 폴더들 + 개별로 추가한 프로젝트 경로
    project_roots: list[str] = field(default_factory=list)
    extra_projects: list[str] = field(default_factory=list)
    # v0.3: 프로젝트별 설정 { projectKey: {"tags": [tagId...], "assetRoot": "Assets/...", "hidden": bool, "alias": str} }
    projects: dict = field(default_factory=dict)
    # v0.3.1: 태그 세트 [{"id", "name", "tags": [tagId...]}] — 프로젝트에 한 번에 적용
    tag_sets: list = field(default_factory=list)

    @property
    def queue_folder(self) -> str:
        return self.unity_queue_folder or str(Path(self.intake_folder) / "_queue")

    @property
    def projects_queue_root(self) -> str:
        # 프로젝트별 큐. 구버전 유니티 패키지가 _queue 를 하위폴더까지 감시하므로 그 밖에 둔다.
        return str(Path(self.intake_folder) / "_projects")

    def save(self) -> None:
        ensure_special_tags(self)
        CONFIG_PATH.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
        write_bridge(self)

    @classmethod
    def load(cls) -> "AppConfig":
        if not CONFIG_PATH.exists():
            cfg = cls()
            cfg.save()
            return cfg
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            data["tags"] = [Tag(**tag) for tag in data.get("tags", [])]
            known = set(cls.__dataclass_fields__)
            cfg = cls(**{k: v for k, v in data.items() if k in known})
            ensure_special_tags(cfg)
            Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
            Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
            Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
            return cfg
        except Exception:
            cfg = cls()
            cfg.save()
            return cfg


def write_bridge(cfg: AppConfig) -> None:
    """유니티 패키지가 설정 없이도 보관 폴더를 찾을 수 있게 고정 위치에 남긴다."""
    import os
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        return
    try:
        target = Path(base) / "BoothImportManager"
        target.mkdir(parents=True, exist_ok=True)
        (target / "bridge.json").write_text(json.dumps({
            "intakeFolder": cfg.intake_folder,
            "projectsQueueRoot": cfg.projects_queue_root,
            "legacyQueueFolder": cfg.queue_folder,
            "port": cfg.port,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


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
