from __future__ import annotations

import socket
import threading
import time
import webbrowser
import atexit
import sys
from pathlib import Path

from app import AppHandler, ThreadingHTTPServer
from asset_state import cleanup_final_records_on_start
from config import get_config, write_bridge


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    cfg = get_config()
    Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
    cleanup_final_records_on_start()
    write_bridge(cfg)
    atexit.register(cleanup_final_records_on_start)
    url = f"http://127.0.0.1:{cfg.port}/"

    if not _port_open(cfg.port):
        server = ThreadingHTTPServer(("127.0.0.1", cfg.port), AppHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        time.sleep(0.4)
    else:
        server = None
        thread = None

    # --background: 윈도우 시작프로그램용. 브라우저를 열지 않고 서버만 상주.
    if "--background" not in sys.argv:
        webbrowser.open(url)

    try:
        if thread is None:
            return
        while thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        return
    finally:
        if server:
            server.server_close()


if __name__ == "__main__":
    main()
