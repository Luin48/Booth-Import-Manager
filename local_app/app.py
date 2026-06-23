from __future__ import annotations

import json
import mimetypes
import uuid
import atexit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from config import AppConfig, RESOURCE_DIR, Tag, UNTAGGED_TAG_NAME, ensure_special_tags, get_config, reload_config
from asset_state import cleanup_final_records_on_start, hide_record, mark_no_package, mark_queued, refresh_import_status, remove_record
from file_mover import move_completed_booth_file, scan_intake_files
from models import LocalAsset
from queue_manager import queue_for_unity
from tag_state import load_tag_state, remove_asset_tag, set_asset_tag


def _asset_payload() -> list[dict]:
    tag_state = load_tag_state()
    asset_state = refresh_import_status()
    payload = []
    for path in scan_intake_files():
        record = asset_state.get(path.name, {})
        if record.get("hidden"):
            continue
        item = LocalAsset.from_path(path, tag_state.get(path.name, "")).__dict__
        item["status"] = record.get("status", "pending")
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
    }


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


class AppHandler(BaseHTTPRequestHandler):
    server_version = "BoothImportManager/0.1"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self._json({"status": "ok"})

    def do_GET(self) -> None:
        path = self._path()
        if path == "/ping":
            self._json({"status": "ok", "app": "BoothImportManager"})
        elif path == "/api/assets":
            self._json(_asset_payload())
        elif path == "/api/config":
            self._json(_config_payload())
        else:
            self._static(path)

    def do_POST(self) -> None:
        path = self._path()
        data = _read_json(self)
        if path == "/api/download-complete":
            self._download_complete(data)
        elif path == "/api/assets/queue":
            self._queue_assets(data)
        elif path == "/api/assets/hide":
            self._hide_assets(data)
        elif path == "/api/config":
            self._save_config(data)
        else:
            self._json({"error": "not found"}, 404)

    def do_PATCH(self) -> None:
        path = self._path()
        if path.startswith("/api/assets/"):
            filename = Path(unquote(path.removeprefix("/api/assets/"))).name
            data = _read_json(self)
            set_asset_tag(filename, str(data.get("tag", "")).strip())
            self._json({"status": "saved"})
        else:
            self._json({"error": "not found"}, 404)

    def do_DELETE(self) -> None:
        path = self._path()
        if path.startswith("/api/assets/"):
            cfg = get_config()
            filename = Path(unquote(path.removeprefix("/api/assets/"))).name
            target = Path(cfg.intake_folder) / filename
            target.unlink(missing_ok=True)
            remove_asset_tag(filename)
            remove_record(filename)
            self._json({"status": "deleted"})
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
            moved = move_completed_booth_file(filename)
            self._json({"status": "moved", "filename": moved.name})
        except Exception as exc:
            self._json({"error": str(exc)}, 500)

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
                results.append(queue_for_unity(filename, tag, delete_local))
                result = results[-1]
                if result.get("status") == "no_package":
                    mark_no_package(filename)
                else:
                    mark_queued(filename, result.get("queued", []))
                if delete_local:
                    remove_asset_tag(filename)
            except Exception as exc:
                results.append({"filename": filename, "error": str(exc)})
        self._json(results)

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
        for tag in tags:
            if tag.name == UNTAGGED_TAG_NAME:
                tag.name = UNTAGGED_TAG_NAME
        cfg = AppConfig(
            download_folder=data.get("downloadFolder", current.download_folder),
            intake_folder=data.get("intakeFolder", current.intake_folder),
            unity_queue_folder=data.get("queueFolder", current.queue_folder),
            port=int(data.get("port", current.port)),
            tags=tags,
            delete_local_after_queue=bool(data.get("deleteLocalAfterQueue", current.delete_local_after_queue)),
        )
        ensure_special_tags(cfg)
        Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
        Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
        Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
        cfg.save()
        reload_config()
        self._json({"status": "saved"})

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
    cleanup_final_records_on_start()
    atexit.register(cleanup_final_records_on_start)
    server = ThreadingHTTPServer(("127.0.0.1", cfg.port), AppHandler)
    print(f"Booth Import Manager: http://127.0.0.1:{cfg.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
