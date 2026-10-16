"""BOOTH 상품 썸네일 / 샵 프로필 이미지 받아두기 (유니티 폴더 아이콘용).

보관폴더/_booth/
  items/<itemId>.json        상품 정보 캐시
  thumbs/item_<itemId>.jpg   상품 썸네일 (300x300)
  thumbs/shop_<subdomain>.jpg 샵 프로필 (128x128)
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

from config import get_config

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BoothImportManager"
CACHE_SEC = 7 * 24 * 3600


def _root() -> Path:
    root = Path(get_config().intake_folder) / "_booth"
    (root / "items").mkdir(parents=True, exist_ok=True)
    (root / "thumbs").mkdir(parents=True, exist_ok=True)
    return root


def _get(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://booth.pm/"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def item_id_from(value: str) -> str:
    value = str(value or "").strip()
    if value.isdigit():
        return value
    m = re.search(r"items/(\d+)", value)
    return m.group(1) if m else ""


def item_json(item_id: str) -> dict:
    path = _root() / "items" / f"{item_id}.json"
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_SEC:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            pass
    data = json.loads(_get(f"https://booth.pm/ja/items/{item_id}.json").decode("utf-8"))
    slim = {
        "id": str(data.get("id", item_id)),
        "name": data.get("name", ""),
        "url": data.get("url", ""),
        "image": ((data.get("images") or [{}])[0] or {}).get("resized", ""),
        "imageOriginal": ((data.get("images") or [{}])[0] or {}).get("original", ""),
        "shop": {
            "name": (data.get("shop") or {}).get("name", ""),
            "subdomain": (data.get("shop") or {}).get("subdomain", ""),
            "url": (data.get("shop") or {}).get("url", ""),
            "thumbnail": (data.get("shop") or {}).get("thumbnail_url", ""),
        },
    }
    path.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
    return slim


def _save_image(target: Path, urls: list[str], size: int) -> str:
    if target.exists() and target.stat().st_size > 0:
        return str(target)
    for url in urls:
        if not url:
            continue
        try:
            raw = _get(url)
        except Exception:
            continue
        data = raw
        try:  # Pillow 가 있으면 정사각형으로 줄여서 저장 (없어도 동작)
            from io import BytesIO

            from PIL import Image

            im = Image.open(BytesIO(raw)).convert("RGB")
            w, h = im.size
            side = min(w, h)
            im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
            im = im.resize((size, size))
            buf = BytesIO()
            im.save(buf, "JPEG", quality=90)
            data = buf.getvalue()
        except Exception:
            pass
        target.write_bytes(data)
        return str(target)
    return ""


def ensure_icons(item_id: str) -> dict:
    """상품/샵 이미지를 받아서 로컬 경로를 돌려준다. 실패해도 예외 대신 빈 값."""
    item_id = item_id_from(item_id)
    if not item_id:
        return {}
    try:
        info = item_json(item_id)
    except Exception as exc:
        return {"itemId": item_id, "error": str(exc)}
    thumbs = _root() / "thumbs"
    image = info.get("image", "")
    item_urls = [
        image.replace("/c/72x72_a2_g5/", "/c/300x300_a2_g5/") if "/c/72x72_a2_g5/" in image else "",
        info.get("imageOriginal", ""),
        image,
    ]
    shop = info.get("shop") or {}
    shop_thumb = shop.get("thumbnail", "")
    shop_urls = [
        shop_thumb.replace("/c/48x48/", "/c/128x128/") if "/c/48x48/" in shop_thumb else "",
        shop_thumb,
    ]
    shop_key = re.sub(r"[^A-Za-z0-9_-]", "_", shop.get("subdomain") or shop.get("name") or "shop")
    return {
        "itemId": item_id,
        "itemName": info.get("name", ""),
        "itemUrl": info.get("url", "") or f"https://booth.pm/ja/items/{item_id}",
        "shopName": shop.get("name", ""),
        "shopSubdomain": shop.get("subdomain", ""),
        "shopUrl": shop.get("url", ""),
        "itemThumb": _save_image(thumbs / f"item_{item_id}.jpg", item_urls, 256),
        "shopIcon": _save_image(thumbs / f"shop_{shop_key}.jpg", shop_urls, 128),
    }


def write_sidecar(package_path: str, meta: dict) -> None:
    """큐에 넣은 .unitypackage 옆에 <이름>.unitypackage.booth.json 을 남긴다 (유니티가 읽음)."""
    if not meta or not meta.get("itemId"):
        return
    try:
        Path(f"{package_path}.booth.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass
