from __future__ import annotations

import json
import mimetypes
import shutil
import uuid
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import booth_icons
import booth_meta
import projects
from config import AppConfig, RESOURCE_DIR, Tag, UNTAGGED_TAG_NAME, ensure_special_tags, get_config, reload_config, write_bridge
from asset_state import (
    cleanup_final_records_on_start,
    hide_record,
    mark_no_package,
    mark_queued,
    refresh_import_status,
    remove_record,
    reset_record,
)
from file_mover import move_completed_booth_file, scan_intake_files
from models import LocalAsset
from queue_manager import queue_for_unity
from tag_state import load_tag_state, remove_asset_tag, set_asset_tag


APP_VERSION = "0.3.1"


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _delete_local_artifacts(filename: str, record: dict) -> int:
    cfg = get_config()
    intake = Path(cfg.intake_folder)
    source = intake / filename
    deleted = 0

    if source.exists():
        source.unlink()
        deleted += 1

    candidates: list[Path] = []
    for raw_path in record.get("extracted_paths", []):
        if raw_path:
            candidates.append(Path(raw_path))

    if source.suffix.lower() != ".unitypackage":
        stem_dir = source.with_suffix("")
        candidates.append(stem_dir)
        if intake.exists():
            candidates.extend(
                path
                for path in intake.iterdir()
                if path.is_dir()
                and path.name.startswith(f"{stem_dir.name}_")
                and path.name[len(stem_dir.name) + 1 :].isdigit()
            )

    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if not candidate.exists() or not candidate.is_dir():
            continue
        if resolved == intake.resolve() or not _is_within(candidate, intake):
            continue
        shutil.rmtree(candidate)
        deleted += 1

    return deleted


def _asset_payload(include_hidden: bool = False) -> list[dict]:
    tag_state = load_tag_state()
    asset_state = refresh_import_status()
    meta = booth_meta.refresh()
    payload = []
    for path in scan_intake_files():
        record = asset_state.get(path.name, {})
        if record.get("hidden") and not include_hidden:
            continue
        item = LocalAsset.from_path(path, tag_state.get(path.name, "")).__dict__
        item["status"] = record.get("status", "pending")
        item["hidden"] = bool(record.get("hidden"))
        item["booth"] = {k: v for k, v in meta.get(path.name, {}).items() if k not in ("queuedPaths",)}
        item["mtime"] = int(path.stat().st_mtime)
        payload.append(item)
    return payload


def _config_payload() -> dict:
    cfg = get_config()
    return {
        "downloadFolder": cfg.download_folder,
        "intakeFolder": cfg.intake_folder,
        "queueFolder": cfg.queue_folder,
        "port": cfg.port,
        "tags": [tag.__dict__ for tag in cfg.tags],
        "deleteLocalAfterQueue": cfg.delete_local_after_queue,
        "stayRunning": cfg.stay_running,
        "autoQueue": cfg.auto_queue,
        "projectRoots": cfg.project_roots,
        "extraProjects": cfg.extra_projects,
        "projectsQueueRoot": cfg.projects_queue_root,
        "tagSets": cfg.tag_sets,
    }


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _resolve_project(project_key: str) -> dict | None:
    if not project_key:
        return None
    project = projects.get_project(project_key)
    if project is None:
        raise FileNotFoundError(f"프로젝트를 찾을 수 없어요: {project_key}")
    return project


def _queue_one(filename: str, tag: str, delete_local: bool = False, project_key: str = "") -> dict:
    project = _resolve_project(project_key)
    if project:
        projects.write_project_file(project_key, project)
    booth = None
    item_id = booth_meta.refresh().get(filename, {}).get("itemId", "")
    if item_id and project_key:
        icons = booth_icons.ensure_icons(item_id)
        if icons.get("itemId"):
            entry = booth_meta.refresh().get(filename, {})
            booth = {**icons, "fileLabel": entry.get("fileLabel", ""), "sourceFile": filename}
    result = queue_for_unity(filename, tag, delete_local, project_key, booth)
    booth_meta.ensure_entry(filename)
    project_name = project["name"] if project else "(공용 큐)"
    if result.get("status") == "no_package":
        mark_no_package(filename, result.get("extracted", []))
        booth_meta.add_queue(filename, project_key, project_name, tag, [], "no_package")
    else:
        mark_queued(filename, result.get("queued", []), result.get("extracted", []))
        booth_meta.add_queue(filename, project_key, project_name, tag, result.get("queued", []), "pending")
    set_asset_tag(filename, tag)
    if delete_local or get_config().delete_local_after_queue:
        remove_asset_tag(filename)
        booth_meta.mark_local_deleted(filename)
    result["projectName"] = project_name
    result["running"] = bool(project and project.get("running"))
    return result


def _pick_folder(initial: str = "") -> str:
    """윈도우 폴더 선택 창 (tkinter). 실패하면 빈 문자열."""
    try:
        import tkinter
        from tkinter import filedialog

        root = tkinter.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        chosen = filedialog.askdirectory(initialdir=initial or None, title="폴더 선택")
        root.destroy()
        return chosen or ""
    except Exception:
        return ""


_pick_lock = threading.Lock()


class AppHandler(BaseHTTPRequestHandler):
    server_version = f"BoothImportManager/{APP_VERSION}"

    # --- 접근 제어 -------------------------------------------------------
    # v0.2 는 Access-Control-Allow-Origin: * 이라서 아무 웹페이지나 로컬 삭제 API 를
    # 호출할 수 있었다. 이제 앱 자체 화면(127.0.0.1)과 크롬 확장만 허용한다.
    def _origin(self) -> str:
        return self.headers.get("Origin", "") or ""

    def _origin_allowed(self) -> bool:
        origin = self._origin()
        if not origin:
            return True  # 같은 출처 GET, curl, 유니티 등
        if origin.startswith("chrome-extension://"):
            return True
        port = get_config().port
        return origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

    def end_headers(self) -> None:
        origin = self._origin()
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def _guard(self) -> bool:
        if self._origin_allowed():
            return True
        self._json({"error": "origin not allowed"}, 403)
        return False

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        if not self._guard():
            return
        path = self._path()
        query = parse_qs(urlparse(self.path).query)
        if path == "/ping":
            self._json({"status": "ok", "app": "BoothImportManager", "version": APP_VERSION})
        elif path == "/api/assets":
            self._json(_asset_payload(include_hidden=query.get("all", ["0"])[0] == "1"))
        elif path == "/api/config":
            self._json(_config_payload())
        elif path == "/api/projects":
            self._json(projects.list_projects(include_hidden=query.get("all", ["1"])[0] == "1"))
        elif path == "/api/projects/suggest":
            self._json(projects.suggest_roots())
        elif path.startswith("/api/projects/") and path.endswith("/queue"):
            key = unquote(path.removeprefix("/api/projects/").removesuffix("/queue"))
            self._json(projects.pending_files(Path(key).name))
        else:
            self._static(path)

    def do_POST(self) -> None:
        if not self._guard():
            return
        path = self._path()
        data = _read_json(self)
        if path == "/api/download-complete":
            self._download_complete(data)
        elif path == "/api/assets/queue":
            self._queue_assets(data)
        elif path == "/api/assets/hide":
            self._hide_assets(data)
        elif path == "/api/booth/status":
            self._booth_status(data)
        elif path == "/api/booth/requeue":
            self._booth_requeue(data)
        elif path == "/api/config":
            self._save_config(data)
        elif path == "/api/projects/settings":
            self._project_settings(data)
        elif path == "/api/projects/install":
            self._project_install(data)
        elif path == "/api/projects/add":
            self._project_add(data)
        elif path == "/api/queue/cancel":
            self._queue_cancel(data)
        elif path == "/api/queue/retry":
            self._queue_retry(data)
        elif path == "/api/booth/icons":
            self._booth_icons(data)
        elif path == "/api/pick-folder":
            self._pick_folder(data)
        elif path == "/api/shutdown":
            self._shutdown(data)
        else:
            self._json({"error": "not found"}, 404)

    def do_PATCH(self) -> None:
        if not self._guard():
            return
        path = self._path()
        if path.startswith("/api/assets/"):
            filename = Path(unquote(path.removeprefix("/api/assets/"))).name
            data = _read_json(self)
            set_asset_tag(filename, str(data.get("tag", "")).strip())
            self._json({"status": "saved"})
        else:
            self._json({"error": "not found"}, 404)

    def do_DELETE(self) -> None:
        if not self._guard():
            return
        path = self._path()
        if path.startswith("/api/assets/"):
            filename = Path(unquote(path.removeprefix("/api/assets/"))).name
            record = refresh_import_status().get(filename, {})
            deleted = _delete_local_artifacts(filename, record)
            remove_asset_tag(filename)
            remove_record(filename)
            booth_meta.mark_local_deleted(filename)
            self._json({"status": "deleted", "deleted": deleted})
        else:
            self._json({"error": "not found"}, 404)

    def log_message(self, fmt: str, *args) -> None:
        return

    def _path(self) -> str:
        return urlparse(self.path).path

    def _json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # --- 다운로드 완료 ---------------------------------------------------
    def _download_complete(self, data: dict) -> None:
        filename = Path(str(data.get("filename", ""))).name
        markers = (data.get("sourceUrl", ""), data.get("finalUrl", ""), data.get("referrer", ""))
        if not filename:
            self._json({"error": "filename required"}, 400)
            return
        if not any("booth.pm" in str(marker) for marker in markers):
            self._json({"status": "ignored", "reason": "not booth.pm"})
            return
        try:
            moved = move_completed_booth_file(filename, str(data.get("fullPath", "") or ""))
        except Exception as exc:
            self._json({"error": str(exc)}, 500)
            return

        name = moved.name
        tag = str(data.get("tag", "") or "").strip()
        booth = data.get("booth") if isinstance(data.get("booth"), dict) else {}
        reset_record(name)
        booth_meta.record_download(name, booth)
        if tag:
            set_asset_tag(name, tag)

        result: dict = {"status": "moved", "filename": name}
        project_key = str(data.get("project", "") or "")
        if tag and bool(data.get("autoQueue", False)):
            try:
                queued = _queue_one(name, tag, project_key=project_key)
                result.update({k: queued.get(k) for k in ("queued", "projectName", "running")})
                result["status"] = queued.get("status", "queued")
            except Exception as exc:
                result["queueError"] = str(exc)
        self._json(result)

    def _queue_assets(self, data: dict) -> None:
        items = data.get("items", [])
        delete_local = bool(data.get("deleteLocal", False))
        results = []
        for item in items:
            filename = Path(str(item.get("filename", ""))).name
            tag = str(item.get("tag", "")).strip()
            if not filename or not tag:
                results.append({"filename": filename, "error": "filename and tag required"})
                continue
            try:
                results.append(_queue_one(filename, tag, delete_local, str(item.get("project", "") or "")))
            except Exception as exc:
                results.append({"filename": filename, "error": str(exc)})
        self._json(results)

    def _booth_status(self, data: dict) -> None:
        item_ids = [str(i) for i in data.get("itemIds", [])][:500]
        dl_ids = [str(i) for i in data.get("downloadableIds", [])][:2000]
        status = booth_meta.item_status(item_ids, dl_ids)
        # 보관 폴더에 실제 파일이 남아 있는지 다시 확인
        intake = Path(get_config().intake_folder)
        for entry in status["downloadables"].values():
            entry["present"] = (intake / entry["filename"]).exists()
        self._json(status)

    def _booth_requeue(self, data: dict) -> None:
        """이미 받아둔 파일을 다시 큐로 (재다운로드 없이)."""
        dl_id = str(data.get("downloadableId", ""))
        tag = str(data.get("tag", "")).strip()
        found = booth_meta.find_by_downloadable(dl_id)
        if not found or not tag:
            self._json({"error": "not found"}, 404)
            return
        filename, _ = found
        if not (Path(get_config().intake_folder) / filename).exists():
            self._json({"error": "local file missing"}, 404)
            return
        try:
            self._json(_queue_one(filename, tag, project_key=str(data.get("project", "") or "")))
        except Exception as exc:
            self._json({"error": str(exc)}, 500)

    def _project_settings(self, data: dict) -> None:
        """{ key, tags?, assetRoot?, hidden?, alias? } 또는 { updates: [ ... ] }"""
        cfg = get_config()
        updates = data.get("updates") if isinstance(data.get("updates"), list) else [data]
        tag_ids = {t.id for t in cfg.tags}
        for upd in updates:
            key = Path(str(upd.get("key", ""))).name
            if not key:
                continue
            settings = cfg.projects.setdefault(key, {})
            if "tags" in upd:
                settings["tags"] = None if upd["tags"] is None else [t for t in upd["tags"] if t in tag_ids]
            if "assetRoot" in upd:
                root = str(upd["assetRoot"] or "Assets").replace("\\", "/").strip().strip("/")
                settings["assetRoot"] = root if root.startswith("Assets") else f"Assets/{root}"
            if "hidden" in upd:
                settings["hidden"] = bool(upd["hidden"])
            if "alias" in upd:
                settings["alias"] = str(upd["alias"] or "").strip()
        cfg.save()
        for upd in updates:
            key = Path(str(upd.get("key", ""))).name
            project = projects.get_project(key) if key else None
            if project:
                projects.write_project_file(key, project)
        self._json({"status": "saved"})

    def _project_install(self, data: dict) -> None:
        project = projects.get_project(Path(str(data.get("key", ""))).name)
        if not project:
            self._json({"error": "프로젝트를 찾을 수 없어요"}, 404)
            return
        try:
            result = projects.install_package(project["path"])
            projects.write_project_file(project["key"], project)
            self._json(result)
        except Exception as exc:
            self._json({"error": str(exc)}, 500)

    def _project_add(self, data: dict) -> None:
        path = str(data.get("path", "")).strip()
        if not path or not projects.is_unity_project(Path(path)):
            self._json({"error": "유니티 프로젝트 폴더가 아니에요 (Assets, ProjectSettings 필요)"}, 400)
            return
        cfg = get_config()
        if projects.normalize_path(path) not in {projects.normalize_path(p) for p in cfg.extra_projects}:
            cfg.extra_projects.append(path)
            cfg.save()
        self._json({"status": "added", "key": projects.key_for_path(path)})

    def _queue_cancel(self, data: dict) -> None:
        target = Path(str(data.get("path", "")))
        root = Path(get_config().projects_queue_root)
        if not target.name.endswith((".unitypackage", ".unitypackage.failed")) or not _is_within(target, root):
            self._json({"error": "invalid path"}, 400)
            return
        target.unlink(missing_ok=True)
        Path(str(target).removesuffix(".failed") + ".booth.json").unlink(missing_ok=True)
        booth_meta.cancel_path(str(target).removesuffix(".failed"))
        self._json({"status": "cancelled"})

    def _queue_retry(self, data: dict) -> None:
        target = Path(str(data.get("path", "")))
        root = Path(get_config().projects_queue_root)
        if not target.name.endswith(".unitypackage.failed") or not _is_within(target, root) or not target.exists():
            self._json({"error": "invalid path"}, 400)
            return
        original = Path(str(target).removesuffix(".failed"))
        target.replace(original)
        booth_meta.retry_path(str(original))
        self._json({"status": "pending"})

    def _booth_icons(self, data: dict) -> None:
        """유니티의 '부스 상품 연결' 메뉴용: 상품 URL/ID → 썸네일·샵 아이콘 로컬 경로."""
        result = booth_icons.ensure_icons(str(data.get("item", "")))
        if not result.get("itemId"):
            self._json({"error": "상품 번호를 찾지 못했어요"}, 400)
        elif result.get("error"):
            self._json(result, 502)
        else:
            self._json(result)

    def _pick_folder(self, data: dict) -> None:
        if not _pick_lock.acquire(blocking=False):
            self._json({"error": "이미 폴더 선택 창이 열려 있어요"}, 409)
            return
        try:
            self._json({"path": _pick_folder(str(data.get("initial", "")))})
        finally:
            _pick_lock.release()

    def _hide_assets(self, data: dict) -> None:
        filenames = [Path(str(name)).name for name in data.get("filenames", [])]
        for filename in filenames:
            if filename:
                hide_record(filename)
        self._json({"status": "hidden", "count": len(filenames)})

    def _save_config(self, data: dict) -> None:
        current = get_config()
        tags = [
            Tag(id=tag.get("id") or str(uuid.uuid4()), name=tag["name"], color=tag.get("color", "#2563eb"))
            for tag in data.get("tags", [tag.__dict__ for tag in current.tags])
            if tag.get("name")
        ]
        cfg = AppConfig(
            download_folder=data.get("downloadFolder", current.download_folder),
            intake_folder=data.get("intakeFolder", current.intake_folder),
            unity_queue_folder=data.get("queueFolder", current.queue_folder),
            port=int(data.get("port", current.port)),
            tags=tags,
            delete_local_after_queue=bool(data.get("deleteLocalAfterQueue", current.delete_local_after_queue)),
            stay_running=bool(data.get("stayRunning", current.stay_running)),
            auto_queue=bool(data.get("autoQueue", current.auto_queue)),
            project_roots=[str(p).strip() for p in data.get("projectRoots", current.project_roots) if str(p).strip()],
            extra_projects=[str(p).strip() for p in data.get("extraProjects", current.extra_projects) if str(p).strip()],
            projects=current.projects,
            tag_sets=[
                {"id": str(ts.get("id") or uuid.uuid4()), "name": str(ts.get("name", "")).strip(), "tags": [str(t) for t in ts.get("tags", [])]}
                for ts in data.get("tagSets", current.tag_sets)
                if isinstance(ts, dict) and str(ts.get("name", "")).strip()
            ],
        )
        # 삭제된 태그는 프로젝트 할당에서도 제거
        tag_ids = {t.id for t in tags}
        for settings in cfg.projects.values():
            if isinstance(settings.get("tags"), list):
                settings["tags"] = [t for t in settings["tags"] if t in tag_ids]
        for ts in cfg.tag_sets:
            ts["tags"] = [t for t in ts["tags"] if t in tag_ids]
        ensure_special_tags(cfg)
        Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
        Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
        Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
        cfg.save()
        reload_config()
        self._json({"status": "saved"})

    def _shutdown(self, data: dict) -> None:
        # 웹 GUI 탭을 닫을 때 보내는 신호(reason=pagehide)는 stay_running 이면 무시
        if data.get("reason") == "pagehide" and get_config().stay_running:
            self._json({"status": "ignored"})
            return
        cleanup_final_records_on_start()
        self._json({"status": "shutting_down"})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _static(self, path: str) -> None:
        root = RESOURCE_DIR / "webui"
        rel = "index.html" if path == "/" else unquote(path).lstrip("/")
        target = (root / rel).resolve()
        if not str(target).startswith(str(root.resolve())) or not target.exists():
            target = root / "index.html"
        content = target.read_bytes()
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".js":
            mime = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    cfg = get_config()
    Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", cfg.port), AppHandler)
    print(f"Booth Import Manager: http://127.0.0.1:{cfg.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
