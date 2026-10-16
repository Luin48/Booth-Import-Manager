"""unity_package/BoothImportManager 를 .unitypackage 로 묶는다 (유니티 없이).

결과물을 임포트하면 Assets/BoothImportManager/ 에 들어간다.
(ALCOM/VCC 저장소로 추가하거나 관리 페이지의 '설치' 버튼을 쓰면 Packages/ 쪽에 들어간다.)
사용: python scripts/make_unitypackage.py dist/BoothImportManager.unitypackage
"""
from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "unity_package" / "BoothImportManager"
TARGET_PREFIX = "Assets/BoothImportManager"


def guid_for(path: str) -> str:
    # 같은 경로는 항상 같은 GUID → 재임포트해도 중복 생성되지 않음
    return hashlib.md5(f"booth-import-manager:{path}".encode("utf-8")).hexdigest()


def meta_for(guid: str, is_folder: bool, suffix: str) -> str:
    if is_folder:
        return f"fileFormatVersion: 2\nguid: {guid}\nfolderAsset: yes\nDefaultImporter:\n  externalObjects: {{}}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    if suffix == ".cs":
        return f"fileFormatVersion: 2\nguid: {guid}\nMonoImporter:\n  externalObjects: {{}}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {{instanceID: 0}}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    if suffix == ".asmdef":
        return f"fileFormatVersion: 2\nguid: {guid}\nAssemblyDefinitionImporter:\n  externalObjects: {{}}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    return f"fileFormatVersion: 2\nguid: {guid}\nTextScriptImporter:\n  externalObjects: {{}}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"


def add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = int(time.time())
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(data))


def main(out: str) -> None:
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    entries: list[tuple[str, Path | None]] = [(TARGET_PREFIX, None)]
    for p in sorted(SRC.rglob("*")):
        if p.name == "package.json" or p.suffix == ".meta":
            continue
        rel = p.relative_to(SRC).as_posix()
        entries.append((f"{TARGET_PREFIX}/{rel}", None if p.is_dir() else p))
    with tarfile.open(out_path, "w:gz") as tar:
        for asset_path, file in entries:
            guid = guid_for(asset_path)
            add_bytes(tar, f"{guid}/pathname", asset_path.encode("utf-8"))
            add_bytes(tar, f"{guid}/asset.meta", meta_for(guid, file is None, Path(asset_path).suffix).encode("utf-8"))
            if file is not None:
                add_bytes(tar, f"{guid}/asset", file.read_bytes())
    print(f"written {out_path} ({len(entries)} entries)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "dist" / "BoothImportManager.unitypackage"))
