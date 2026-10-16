from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from app import APP_VERSION, AppHandler, ThreadingHTTPServer, known_extension
from asset_state import cleanup_final_records_on_start
from config import APP_DIR, RESOURCE_DIR, get_config, write_bridge

STARTUP_NAME = "BoothImportManager.lnk"


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


# ---- 윈도우 도우미 ------------------------------------------------------------
def _chrome_path() -> str:
    if sys.platform != "win32":
        return ""
    try:
        import winreg

        for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(root, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as key:
                    value, _ = winreg.QueryValueEx(key, None)
                    if value and Path(value).exists():
                        return value
            except OSError:
                continue
    except ImportError:
        pass
    for candidate in (
        Path(os.environ.get("PROGRAMFILES", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ):
        if candidate.exists():
            return str(candidate)
    return ""


def _startup_link() -> Path:
    return Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup" / STARTUP_NAME


def _startup_enabled() -> bool:
    return sys.platform == "win32" and _startup_link().exists()


def _set_startup(enable: bool) -> None:
    link = _startup_link()
    if not enable:
        link.unlink(missing_ok=True)
        return
    target = sys.executable if getattr(sys, "frozen", False) else str(Path(sys.executable).with_name("pythonw.exe"))
    args = "--background" if getattr(sys, "frozen", False) else f'"{Path(__file__).resolve()}" --background'
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK);"
        "$s.TargetPath=$env:TGT;$s.Arguments=$env:ARGS;$s.WorkingDirectory=$env:WD;$s.Save()"
    )
    env = {**os.environ, "LNK": str(link), "TGT": target, "ARGS": args, "WD": str(APP_DIR)}
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        check=False,
    )


def _open_manage(url: str) -> None:
    ext_id = known_extension()
    chrome = _chrome_path()
    if ext_id and chrome:
        subprocess.Popen([chrome, f"chrome-extension://{ext_id}/manage.html"], creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    else:
        webbrowser.open(url)


def _open_folder(path: str) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        webbrowser.open(Path(path).as_uri())


# ---- 트레이 -----------------------------------------------------------------
def _run_tray(server, server_thread: threading.Thread, url: str) -> bool:
    """트레이 아이콘을 띄우고 종료될 때까지 막는다. pystray 가 없으면 False."""
    try:
        import pystray
        from PIL import Image
    except Exception:
        return False

    icon_path = RESOURCE_DIR / "assets" / "booth-import-manager-icon.png"
    try:
        image = Image.open(icon_path)
    except Exception:
        image = Image.new("RGB", (64, 64), (79, 183, 223))

    def quit_app(icon, _item=None):
        icon.visible = False
        if server is not None:
            threading.Thread(target=server.shutdown, daemon=True).start()
        icon.stop()

    def toggle_startup(icon, _item):
        _set_startup(not _startup_enabled())
        icon.update_menu()

    cfg = get_config()
    menu = pystray.Menu(
        pystray.MenuItem(f"Booth Import Manager v{APP_VERSION}", None, enabled=False),
        pystray.MenuItem("관리 페이지 열기", lambda: _open_manage(url), default=True),
        pystray.MenuItem("예전 웹 화면 열기", lambda: webbrowser.open(url)),
        pystray.MenuItem("보관 폴더 열기", lambda: _open_folder(get_config().intake_folder)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("윈도우 시작 시 자동 실행", toggle_startup, checked=lambda _i: _startup_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("종료", quit_app),
    )
    icon = pystray.Icon("BoothImportManager", image, f"Booth Import Manager (포트 {cfg.port})", menu)

    # 크롬/관리 페이지에서 '로컬 앱 종료'를 누르면 서버가 멈춘다 → 트레이도 같이 닫기
    def watch_server():
        server_thread.join()
        try:
            icon.stop()
        except Exception:
            pass

    threading.Thread(target=watch_server, daemon=True).start()
    icon.run()
    return True


def main() -> None:
    cfg = get_config()
    Path(cfg.download_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.intake_folder).mkdir(parents=True, exist_ok=True)
    Path(cfg.queue_folder).mkdir(parents=True, exist_ok=True)
    cleanup_final_records_on_start()
    write_bridge(cfg)
    atexit.register(cleanup_final_records_on_start)
    url = f"http://127.0.0.1:{cfg.port}/"

    if _port_open(cfg.port):
        # 이미 실행 중 — 두 번째 실행은 화면만 열고 끝낸다
        if "--background" not in sys.argv:
            _open_manage(url)
        return

    server = ThreadingHTTPServer(("127.0.0.1", cfg.port), AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    # --background: 윈도우 시작프로그램용. 화면을 열지 않고 트레이에만 상주.
    if "--background" not in sys.argv:
        _open_manage(url)

    try:
        if not _run_tray(server, thread, url):
            while thread.is_alive():
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
