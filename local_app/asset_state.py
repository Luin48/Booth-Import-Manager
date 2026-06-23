from __future__ import annotations

import json
from pathlib import Path

from config import APP_DIR


STATE_PATH = APP_DIR / "asset_state.json"
FINAL_STATUSES = {"imported", "no_package"}


def load_asset_state() -> dict[str, dict]:
    if not STATE_PATH.exists():
        return {}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_asset_state(state: dict[str, dict]) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def refresh_import_status() -> dict[str, dict]:
    state = load_asset_state()
    changed = False
    for record in state.values():
        if record.get("status") != "queued":
            continue
        queued_paths = [Path(path) for path in record.get("queued_paths", [])]
        if queued_paths and all(not path.exists() for path in queued_paths):
            record["status"] = "imported"
            changed = True
    if changed:
        save_asset_state(state)
    return state


def cleanup_final_records_on_start() -> None:
    state = refresh_import_status()
    changed = False
    for record in state.values():
        if record.get("status") in FINAL_STATUSES and not record.get("hidden"):
            record["hidden"] = True
            changed = True
    if changed:
        save_asset_state(state)


def get_record(filename: str) -> dict:
    return refresh_import_status().get(filename, {})


def mark_queued(filename: str, queued_paths: list[str]) -> None:
    state = load_asset_state()
    state[filename] = {
        **state.get(filename, {}),
        "status": "queued",
        "queued_paths": queued_paths,
        "hidden": False,
    }
    save_asset_state(state)


def mark_no_package(filename: str) -> None:
    state = load_asset_state()
    state[filename] = {
        **state.get(filename, {}),
        "status": "no_package",
        "queued_paths": [],
        "hidden": False,
    }
    save_asset_state(state)


def hide_record(filename: str) -> None:
    state = load_asset_state()
    state[filename] = {
        **state.get(filename, {}),
        "status": state.get(filename, {}).get("status", "pending"),
        "hidden": True,
    }
    save_asset_state(state)


def remove_record(filename: str) -> None:
    state = load_asset_state()
    if filename in state:
        del state[filename]
        save_asset_state(state)
