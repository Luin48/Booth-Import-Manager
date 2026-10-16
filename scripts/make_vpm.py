"""ALCOM/VCC(VPM)용 패키지 zip 과 저장소 목록(vpm/index.json)을 만든다.

사용:
  python scripts/make_vpm.py zip <out.zip>     # 패키지 zip (package.json 이 맨 위)
  python scripts/make_vpm.py index             # package.json 버전을 vpm/index.json 에 추가/갱신
"""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "unity_package" / "BoothImportManager"
INDEX = ROOT / "vpm" / "index.json"
REPO = "Luin48/Booth-Import-Manager"
INDEX_URL = f"https://raw.githubusercontent.com/{REPO}/main/vpm/index.json"

sys.path.insert(0, str(ROOT / "scripts"))
from make_unitypackage import meta_for  # noqa: E402


def guid_for(rel: str) -> str:
    return hashlib.md5(f"booth-import-manager-pkg:{rel}".encode("utf-8")).hexdigest()


def package_json() -> dict:
    return json.loads((SRC / "package.json").read_text(encoding="utf-8"))


def make_zip(out: str) -> None:
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(SRC.rglob("*")):
            if p.suffix == ".meta":
                continue
            rel = p.relative_to(SRC).as_posix()
            info = zipfile.ZipInfo(rel + ("/" if p.is_dir() else ""), date_time=(2026, 1, 1, 0, 0, 0))
            if p.is_dir():
                z.writestr(info, b"")
            else:
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, p.read_bytes())
            # 고정 GUID 의 .meta 를 같이 넣어 업데이트해도 GUID 가 바뀌지 않게
            meta = zipfile.ZipInfo(rel + ".meta", date_time=(2026, 1, 1, 0, 0, 0))
            meta.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(meta, meta_for(guid_for(rel), p.is_dir(), p.suffix))
    print(f"written {out_path}")


def update_index() -> None:
    pkg = package_json()
    ver = pkg["version"]
    data = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}
    data.setdefault("name", "Booth Import Manager")
    data.setdefault("id", "io.github.luin48.booth-import-manager")
    data.setdefault("author", "Luin48")
    data["url"] = INDEX_URL
    versions = data.setdefault("packages", {}).setdefault(pkg["name"], {}).setdefault("versions", {})
    entry = dict(pkg)
    entry["url"] = f"https://github.com/{REPO}/releases/download/v{ver}/{pkg['name']}-{ver}.zip"
    versions[ver] = entry
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"index: {pkg['name']} {ver}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "zip":
        make_zip(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "index":
        update_index()
    else:
        print(__doc__)
        sys.exit(1)
