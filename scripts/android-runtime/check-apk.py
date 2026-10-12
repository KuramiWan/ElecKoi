"""Verify the runtime distribution and current desktop icon inside the actual APK."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import zipfile

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("apk", type=Path)
parser.add_argument("--aapt2", type=Path)
args = parser.parse_args()


def resource_file_path(table, name):
    blocks = re.findall(r"^\s*resource 0x[0-9a-fA-F]+ ([^\s]+)\s*\n(.*?)(?=^\s*resource 0x|^\s*type |\Z)", table, re.M | re.S)
    entries = [body for identity, body in blocks if identity == name]
    if len(entries) != 1:
        raise ValueError(f"APK resource is missing or ambiguous: {name}")
    files = re.findall(r"^\s*\(nodpi\) \(file\) (res/[^\s]+) type=PNG\s*$", entries[0], re.M)
    if len(files) != 1:
        raise ValueError(f"APK resource has no unique nodpi PNG: {name}")
    return files[0]


def rendered_image_bytes(image):
    from PIL import Image
    rgba = image.convert("RGBA")
    visible = rgba.getchannel("A").point(lambda alpha: 255 if alpha else 0)
    return Image.composite(rgba, Image.new("RGBA", rgba.size), visible).tobytes()


aapt2 = args.aapt2 or shutil.which("aapt2")
if aapt2 is None:
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    tools = Path(sdk) / "build-tools" if sdk else None
    versions = [path for path in tools.iterdir() if re.fullmatch(r"\d+\.\d+\.\d+", path.name)] if tools and tools.is_dir() else []
    if versions:
        selected = max(versions, key=lambda path: tuple(map(int, path.name.split("."))))
        aapt2 = selected / ("aapt2.exe" if os.name == "nt" else "aapt2")
if aapt2 is None:
    raise ValueError("Set ANDROID_HOME or pass --aapt2 to inspect the APK resource table")
resources = subprocess.run([str(aapt2), "dump", "resources", str(args.apk)], check=True, capture_output=True, text=True).stdout
icon_path = resource_file_path(resources, "drawable/eleckoi_app_icon")
execution = json.loads((repo / "apps/android/app/src/main/assets/licenses/glibc/execution-provenance.json").read_text(encoding="utf-8"))
with zipfile.ZipFile(args.apk) as apk:
    active_bytes = sum(item.compress_size for item in apk.infolist())
    overhead = args.apk.stat().st_size - active_bytes
    if overhead > 1024 * 1024:
        raise ValueError(f"APK contains {overhead} bytes outside active ZIP entries; clean Android build outputs before packaging")
    manifest = json.loads(apk.read("assets/runtime/manifest.json"))
    expected = json.loads((repo / "build/android-runtime/assets/runtime/manifest.json").read_text(encoding="utf-8"))
    if manifest != expected:
        raise ValueError("APK contains an older runtime; rebuild against the current verified assets")
    if any(name.startswith("assets/startup/") for name in apk.namelist()):
        raise ValueError("APK contains an extra startup page; use the official Web Client boot process")
    for archive in manifest["archives"]:
        digest, size = hashlib.sha256(), 0
        with apk.open("assets/" + archive["asset"]) as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
                size += len(block)
        if size != archive["bytes"] or digest.hexdigest() != archive["sha256"]:
            raise ValueError(f"APK runtime bytes differ from verified archive: {archive['asset']}")
    spec = importlib.util.spec_from_file_location("android_runtime_packager", repo / "scripts/android-runtime/package-runtime.py")
    packager = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packager)
    with apk.open("assets/runtime/app.archive") as source, tarfile.open(fileobj=source, mode="r:gz") as app:
        packager.verify_shared_asset_layout(app, json.load(app.extractfile("production-closure.json")))
    if json.loads(apk.read("assets/licenses/glibc/execution-provenance.json")) != execution:
        raise ValueError("APK glibc execution provenance differs from the current runtime")
    native_entries = set()
    for output in execution["outputs"]:
        if "/src/main/jniLibs/" not in output["path"]: continue
        entry = "lib/arm64-v8a/" + Path(output["path"]).name
        native_entries.add(entry)
        value = apk.read(entry)
        if len(value) != output["size"] or hashlib.sha256(value).hexdigest() != output["sha256"]:
            raise ValueError(f"APK glibc helper differs from pinned provenance: {output['path']}")
    for name in ("libeleckoi_glibc_android.so", "libeleckoi_glibc_loader.so", "libeleckoi_glibc_probe.so"):
        entry = "lib/arm64-v8a/" + name
        if entry not in apk.namelist(): continue
        source = repo / "apps/android/app/src/debug/jniLibs/arm64-v8a" / name
        if apk.read(entry) != source.read_bytes():
            raise ValueError(f"APK Debug diagnostic differs from its prepared helper: {name}")
        native_entries.add(entry)
    packaged_native = {name for name in apk.namelist() if name.startswith("lib/") and not name.endswith("/")}
    if packaged_native != native_entries:
        raise ValueError(f"APK native files differ from the declared runtime: {sorted(packaged_native ^ native_entries)}")
    if icon_path not in apk.namelist():
        raise ValueError("APK declared icon resource file is missing")
    # The PNG is an existing product asset; Android may only optimize its encoding.
    from PIL import Image
    import io
    with Image.open(repo / "apps/desktop/resources/icons/eleckoi-app-icon.png") as desktop:
        with Image.open(io.BytesIO(apk.read(icon_path))) as android:
            if desktop.size != android.size or rendered_image_bytes(desktop) != rendered_image_bytes(android):
                raise ValueError("APK launcher image differs from the current desktop icon")
print(f"APK size {args.apk.stat().st_size} bytes; active ZIP entries, runtime archives, native provenance and current desktop icon passed: {args.apk}")
