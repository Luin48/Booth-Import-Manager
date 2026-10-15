"""BOOTH 상품 정보와 파일별 처리 이력 (booth_meta.json).

asset_state.json 은 '목록에서 숨김/삭제'와 함께 지워질 수 있지만,
이 이력은 남겨서 라이브러리 배지(받음/대기/임포트됨 + 어느 프로젝트인지)를 계속 보여준다.

entry 예:
{
  "itemId": "8993044", "itemName": "...", "shopName": "...", "downloadableId": "111",
  "status": "imported", "present": true, "downloadedAt": 1790000000,
  "queues": [ {"project": "a1b2c3d4_슈슈", "projectName": "슈슈", "tag": "02.옷",
               "paths": [...], "status": "pending|imported|cancelled|no_package", "at": 1790000000} ]
}
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from config import APP_DIR


META_PATH = APP_DIR / "booth_meta.json"
_lock = threading.RLock()

# 아이템 대표 상태 우선순위
STATUS_RANK = {"": 0, "downloaded": 1, "cancelled": 1, "failed": 2, "no_package": 2, "pending": 3, "queued": 3, "imported": 4}


def _load() -> dict[str, dict]:
    if not META_PATH.exists():
        return {}
    try:
        data = json.loads(META_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict[str, dict]) -> None:
    tmp = META_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(META_PATH)


def _clean_meta(raw: dict | None) -> dict:
    raw = raw or {}
    keys = ("itemId", "itemName", "shopName", "shopUrl", "thumbnail", "downloadableId", "fileLabel", "variation")
    out = {}
    for key in keys:
        value = raw.get(key)
        if value is None or value == "":
            continue
        out[key] = str(value)[:500]
    return out


def _summary(entry: dict) -> str:
    best = "downloaded"
    for q in entry.get("queues", []):
        if STATUS_RANK.get(q.get("status", ""), 0) > STATUS_RANK.get(best, 0):
            best = q.get("status", "")
    return "queued" if best == "pending" else best


def record_download(filename: str, booth: dict | None) -> dict:
    with _lock:
        data = _load()
        entry = data.get(filename, {})
        entry.update(_clean_meta(booth))
        entry["downloadedAt"] = int(time.time())
        entry["present"] = True
        entry.setdefault("queues", [])
        entry["status"] = _summary(entry)
        data[filename] = entry
        _save(data)
        return entry


def ensure_entry(filename: str) -> None:
    """확장 없이 받은 파일도 큐 이력을 남길 수 있게 빈 항목 생성."""
    with _lock:
        data = _load()
        if filename not in data:
            data[filename] = {"present": True, "queues": [], "status": "downloaded", "downloadedAt": int(time.time())}
            _save(data)


def add_queue(filename: str, project: str, project_name: str, tag: str, paths: list[str], status: str) -> None:
    with _lock:
        data = _load()
        entry = data.setdefault(filename, {"present": True, "queues": [], "downloadedAt": int(time.time())})
        queues = entry.setdefault("queues", [])
        # 같은 프로젝트로 다시 보내면 이전 대기 기록은 교체
        queues[:] = [q for q in queues if not (q.get("project") == project and q.get("status") == "pending")]
        queues.append({
            "project": project,
            "projectName": project_name,
            "tag": tag,
            "paths": paths,
            "status": status,
            "at": int(time.time()),
        })
        entry["status"] = _summary(entry)
        _save(data)


def cancel_path(queue_path: str) -> bool:
    with _lock:
        data = _load()
        changed = False
        for entry in data.values():
            for q in entry.get("queues", []):
                if q.get("status") in ("pending", "failed") and queue_path in q.get("paths", []):
                    q["status"] = "cancelled"
                    changed = True
            if changed:
                entry["status"] = _summary(entry)
        if changed:
            _save(data)
        return changed


def retry_path(queue_path: str) -> None:
    with _lock:
        data = _load()
        for entry in data.values():
            for q in entry.get("queues", []):
                if q.get("status") == "failed" and queue_path in q.get("paths", []):
                    q["status"] = "pending"
            entry["status"] = _summary(entry)
        _save(data)


def mark_local_deleted(filename: str) -> None:
    with _lock:
        data = _load()
        if filename in data:
            data[filename]["present"] = False
            _save(data)


def refresh() -> dict[str, dict]:
    """큐 파일이 사라졌으면(유니티가 처리) imported 로 승격."""
    with _lock:
        data = _load()
        changed = False
        for entry in data.values():
            for q in entry.get("queues", []):
                if q.get("status") != "pending":
                    continue
                paths = [Path(p) for p in q.get("paths", [])]
                if any(Path(f"{p}.failed").exists() for p in paths):
                    q["status"] = "failed"
                    changed = True
                elif paths and all(not p.exists() for p in paths):
                    q["status"] = "imported"
                    q["importedAt"] = int(time.time())
                    changed = True
            new_status = _summary(entry)
            if entry.get("status") != new_status:
                entry["status"] = new_status
                changed = True
        if changed:
            _save(data)
        return data


def find_by_downloadable(downloadable_id: str) -> tuple[str, dict] | None:
    best = None
    for filename, entry in refresh().items():
        if entry.get("downloadableId") == str(downloadable_id):
            if best is None or entry.get("downloadedAt", 0) > best[1].get("downloadedAt", 0):
                best = (filename, entry)
    return best


def _project_view(entry: dict) -> list[dict]:
    """프로젝트별 최신 상태 하나씩."""
    latest: dict[str, dict] = {}
    for q in entry.get("queues", []):
        if q.get("status") == "cancelled":
            continue
        key = q.get("project", "")
        if key not in latest or q.get("at", 0) >= latest[key].get("at", 0):
            latest[key] = q
    return [
        {"project": k, "projectName": v.get("projectName", ""), "tag": v.get("tag", ""), "status": v.get("status", "")}
        for k, v in latest.items()
    ]


def item_status(item_ids: list[str], downloadable_ids: list[str] | None = None) -> dict:
    data = refresh()
    wanted_items = {str(i) for i in item_ids if str(i)}
    wanted_dl = {str(i) for i in (downloadable_ids or []) if str(i)}
    items: dict[str, dict] = {}
    downloadables: dict[str, dict] = {}
    for filename, entry in data.items():
        item_id = entry.get("itemId", "")
        dl_id = entry.get("downloadableId", "")
        status = entry.get("status", "downloaded")
        projects = _project_view(entry)
        if item_id in wanted_items:
            current = items.setdefault(item_id, {"status": "", "files": [], "projects": {}})
            current["files"].append({"filename": filename, "status": status})
            for p in projects:
                prev = current["projects"].get(p["project"])
                if prev is None or STATUS_RANK.get(p["status"], 0) > STATUS_RANK.get(prev["status"], 0):
                    current["projects"][p["project"]] = p
            if STATUS_RANK.get(status, 0) > STATUS_RANK.get(current["status"], 0):
                current["status"] = status
        if dl_id in wanted_dl:
            prev = downloadables.get(dl_id)
            if prev is None or entry.get("downloadedAt", 0) >= prev.get("downloadedAt", 0):
                downloadables[dl_id] = {
                    "filename": filename,
                    "status": status,
                    "present": entry.get("present", True),
                    "projects": projects,
                    "downloadedAt": entry.get("downloadedAt", 0),
                }
    for item in items.values():
        item["projects"] = list(item["projects"].values())
    return {"items": items, "downloadables": downloadables}
