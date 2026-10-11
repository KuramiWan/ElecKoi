"""Prepare checksum-locked Android glibc and platform execution helpers."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--ndk", type=Path)
parser.add_argument("--production", action="store_true")
args = parser.parse_args()
lock = json.loads((repo / "native/android-runtime/glibc-lock.json").read_text(encoding="utf-8"))
runtime = json.loads((repo / "scripts/android-runtime/runtime-base-lock.json").read_text(encoding="utf-8"))
native = json.loads((repo / "native/android-runtime/native-build-lock.json").read_text(encoding="utf-8"))
cache = repo / "build/android-runtime/glibc-probe"
cache.mkdir(parents=True, exist_ok=True)
output = repo / ("apps/android/app/src/main/jniLibs/arm64-v8a" if args.production else "apps/android/app/src/debug/jniLibs/arm64-v8a")
output.mkdir(parents=True, exist_ok=True)
common = repo / "apps/android/app/src/main/jniLibs/arm64-v8a"
common.mkdir(parents=True, exist_ok=True)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def verified(spec, directory):
    target = directory / spec["file"]
    directory.mkdir(parents=True, exist_ok=True)
    if not target.is_file():
        with urllib.request.urlopen(spec["url"], timeout=60) as incoming, target.open("wb") as outgoing:
            shutil.copyfileobj(incoming, outgoing)
    if digest(target.read_bytes()) != spec["sha256"]:
        raise ValueError(f"Runtime checksum mismatch: {target.name}")
    return target

def ar_member(archive, requested):
    if archive[:8] != b"!<arch>\n":
        raise ValueError("Invalid glibc package")
    cursor = 8
    while cursor < len(archive):
        header = archive[cursor:cursor + 60]
        if len(header) != 60 or header[58:60] != b"`\n":
            raise ValueError("Invalid package member")
        length = int(header[48:58].decode("ascii").strip())
        name = header[:16].decode("ascii").strip().rstrip("/")
        body = archive[cursor + 60:cursor + 60 + length]
        if name == requested:
            return body
        cursor += 60 + length + length % 2
    raise ValueError(f"Package member missing: {requested}")

original = lock["prefix"]["original"].encode("ascii")
replacement = lock["prefix"]["replacement"].encode("ascii")
if len(replacement) > len(original):
    raise ValueError("Runtime prefix does not fit the locked ELF layout")
replacement += b"/" * (len(original) - len(replacement))
deb = verified(lock["glibc"], cache)
data_tar = ar_member(deb.read_bytes(), "data.tar.xz")
with tarfile.open(fileobj=io.BytesIO(data_tar), mode="r:xz") as archive:
    prefix = "./data/data/com.termux/files/usr/glibc/"
    for spec in lock["elfFiles"]:
        member = archive.getmember(prefix + "lib/" + spec["file"])
        if not member.isfile():
            raise ValueError(f"Expected a regular ELF file: {spec['file']}")
        value = archive.extractfile(member).read()
        if digest(value) != spec["sourceSha256"] or value.count(original) != spec["prefixReplacements"]:
            raise ValueError(f"Unexpected ELF source or prefix layout: {spec['file']}")
        modified = value.replace(original, replacement)
        if len(modified) != len(value) or digest(modified) != spec["sha256"]:
            raise ValueError(f"Portable ELF does not match the verified experiment: {spec['file']}")
        if spec["file"] == "ld-linux-aarch64.so.1":
            if not args.production: (output / "libeleckoi_glibc_android.so").write_bytes(value)
            (common / "libeleckoi_glibc_portable.so").write_bytes(modified)
        else:
            for directory, payload in [(cache / "stage/lib", value), (cache / "portable/usr/glibc/lib", modified)]:
                directory.mkdir(parents=True, exist_ok=True)
                (directory / spec["file"]).write_bytes(payload)
    licenses = repo / ("apps/android/app/src/main/assets/licenses/glibc" if args.production else "apps/android/app/src/debug/assets/licenses/glibc-probe")
    licenses.mkdir(parents=True, exist_ok=True)
    for license_spec in lock["licenses"]:
        member = archive.getmember(prefix + "share/doc/glibc/" + license_spec["target"])
        if not member.issym() or Path(member.linkname).name != license_spec["file"]:
            raise ValueError("Unexpected glibc license reference")
        source = verified(license_spec, cache)
        shutil.copyfile(source, licenses / license_spec["target"])
    (licenses / "provenance.json").write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")

if not args.production:
    ubuntu = verified(runtime["rootfs"], repo / "build/android-runtime/downloads")
    with tarfile.open(ubuntu, "r:gz") as archive:
        value = archive.extractfile(lock["ubuntuLoader"]["member"]).read()
        if digest(value) != lock["ubuntuLoader"]["sha256"]:
            raise ValueError("Stock Ubuntu loader does not match the pinned archive")
        (output / "libeleckoi_glibc_loader.so").write_bytes(value)

if args.ndk is None:
    if os.environ.get("ANDROID_NDK_HOME"):
        args.ndk = Path(os.environ["ANDROID_NDK_HOME"])
    elif os.environ.get("ANDROID_HOME"):
        args.ndk = Path(os.environ["ANDROID_HOME"]) / "ndk" / native["androidNdkVersion"]
    else: raise ValueError("Provide --ndk, ANDROID_NDK_HOME or ANDROID_HOME for the pinned Android NDK")

properties = {key.strip(): value.strip() for key, value in
              (line.split("=", 1) for line in (args.ndk / "source.properties").read_text().splitlines() if "=" in line)}
if properties.get("Pkg.Revision", "").strip() != native["androidNdkVersion"]:
    raise ValueError("Use the Android NDK version pinned by the native build lock")
compiler = args.ndk / "toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe"
target = f"aarch64-linux-android{native['androidApi']}"
helpers = [("glibc-launcher.c", "libeleckoi_node.so")]
if not args.production: helpers.append(("glibc-probe.c", "libeleckoi_glibc_probe.so"))
for source, name in helpers:
    destination = common if source == "glibc-launcher.c" else output
    subprocess.run([str(compiler), f"--target={target}", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIE", "-pie",
                    "-Wl,-z,max-page-size=16384", "-Wl,-z,common-page-size=16384",
                    str(repo / "native/android-runtime" / source), "-o", str(destination / name)], check=True)
for name in ("libeleckoi_node.so", "libeleckoi_glibc_portable.so"):
    obsolete = repo / "apps/android/app/src/debug/jniLibs/arm64-v8a" / name
    if obsolete.exists() or obsolete.is_symlink():
        if obsolete.is_symlink() or not obsolete.is_file():
            raise ValueError(f"Unexpected generated native entry: {obsolete}")
        obsolete.unlink()
subprocess.run([str(compiler), f"--target={target}", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC", "-shared", "-nostdlib",
                "-Wl,-z,max-page-size=16384", "-Wl,-z,common-page-size=16384", "-Wl,-soname,libeleckoi_glibc_exec.so",
                str(repo / "native/android-runtime/glibc-exec.c"), "-o", str(cache / "portable/usr/glibc/lib/libeleckoi_glibc_exec.so")], check=True)
shutil.copyfile(repo / "native/android-runtime/glibc-node-bootstrap.cjs", cache / "bootstrap.cjs")
shutil.copyfile(repo / "scripts/android-runtime/glibc-compatibility-probe.cjs", cache / "compatibility.cjs")
if args.production:
    outputs = [output / "libeleckoi_node.so", output / "libeleckoi_glibc_portable.so",
               *sorted((cache / "portable/usr/glibc/lib").glob("*"))]
    sources = [repo / "native/android-runtime" / name for name in
               ("glibc-launcher.c", "glibc-exec.c", "glibc-node-bootstrap.cjs",
                "android-file-publication.mjs", "session-publication-lock.json")]
    record = lambda file: {"path": file.relative_to(repo).as_posix(), "size": file.stat().st_size, "sha256": digest(file.read_bytes())}
    provenance = {"schemaVersion": 1, "sourceLock": "native/android-runtime/glibc-lock.json",
                  "androidNdkVersion": properties["Pkg.Revision"], "androidApi": native["androidApi"],
                  "sources": [record(file) for file in sources], "outputs": [record(file) for file in outputs]}
    (licenses / "execution-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
print("Prepared Android glibc runtime." if args.production else "Prepared bounded Debug glibc diagnostics.")
