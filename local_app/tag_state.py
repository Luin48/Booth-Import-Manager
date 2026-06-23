from __future__ import annotations

import json
from pathlib import Path

from config import APP_DIR


STATE_PATH = APP_DIR / "tag_state.json"


def load_tag_state() -> dict[str, str]:
    if not STATE_PATH.exists():
        return {}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_tag_state(state: dict[str, str]) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def set_asset_tag(filename: str, tag: str) -> None:
    state = load_tag_state()
    if tag:
        state[filename] = tag
    else:
        state.pop(filename, None)
    save_tag_state(state)


def remove_asset_tag(filename: str) -> None:
    state = load_tag_state()
    state.pop(filename, None)
    save_tag_state(state)
