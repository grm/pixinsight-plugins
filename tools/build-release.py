#!/usr/bin/env python3
"""Build an Astrogrm PixInsight script update package and XRI manifest."""

from __future__ import annotations

import argparse
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
UPDATES_DIR = ROOT / "updates"
SCRIPTS_DIR = ROOT / "src" / "scripts" / "Astrogrm"
PACKAGE_PREFIX = "astrogrm-scripts-v"
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="release version, for example 0.2.0")
    return parser.parse_args()


def script_sources() -> list[Path]:
    sources = []
    for path in sorted(SCRIPTS_DIR.glob("*.js")):
        if path.name.startswith("run-") or path.name.endswith(".test.js"):
            continue
        sources.append(path)
    return sources


def menu_labels(sources: list[Path]) -> list[str]:
    labels = []
    for source in sources:
        for line in source.read_text(encoding="utf-8").splitlines():
            if not line.startswith("#feature-id"):
                continue
            label = line[len("#feature-id") :].strip().rstrip("\\").strip()
            if ":" in label:
                label = label.split(":", 1)[1].strip()
            labels.append(label)
            break
    return labels


def describe_labels(labels: list[str]) -> str:
    if not labels:
        return "Astrogrm scripts"
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return ", ".join(labels[:-1]) + ", and " + labels[-1]


def write_package(package_path: Path, sources: list[Path]) -> None:
    with ZipFile(package_path, "w") as archive:
        for source in sources:
            member = ZipInfo(
                f"src/scripts/Astrogrm/{source.name}",
                date_time=(1980, 1, 1, 0, 0, 0),
            )
            member.compress_type = ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            member.create_system = 3
            archive.writestr(member, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)


def write_manifest(version: str, package_name: str, sha1: str, labels: list[str]) -> None:
    release_date = datetime.now(timezone.utc).strftime("%Y%m%d")
    installed = describe_labels(labels)
    manifest = f'''<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <p><b>Astrogrm PixInsight Scripts</b></p>
      <p>PixInsight scripts maintained by Astrogrm.</p>
   </description>
   <platform os="all" arch="noarch" version="1.9.4:1.9.99">
      <package fileName="{package_name}" sha1="{sha1}" type="script" releaseDate="{release_date}">
         <title>Astrogrm PixInsight Scripts v{version}</title>
         <description>
            <p>Installs {installed}, version {version}, for PixInsight 1.9.4 and later 1.9.x releases.</p>
         </description>
      </package>
   </platform>
</xri>
'''
    (UPDATES_DIR / "updates.xri").write_text(manifest, encoding="utf-8", newline="\n")


def main() -> None:
    args = parse_args()
    if not VERSION_PATTERN.fullmatch(args.version):
        raise SystemExit("Version must use numeric MAJOR.MINOR.PATCH form.")

    sources = script_sources()
    if not sources:
        raise SystemExit(f"No scripts found in {SCRIPTS_DIR}")

    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    for old in UPDATES_DIR.glob(f"{PACKAGE_PREFIX}*.zip"):
        old.unlink()

    package_name = f"{PACKAGE_PREFIX}{args.version}.zip"
    package_path = UPDATES_DIR / package_name
    write_package(package_path, sources)
    sha1 = hashlib.sha1(package_path.read_bytes()).hexdigest()
    labels = menu_labels(sources)
    write_manifest(args.version, package_name, sha1, labels)

    print(f"Built {package_path.relative_to(ROOT)}")
    print("Scripts:")
    for source in sources:
        print(f"  src/scripts/Astrogrm/{source.name}")
    print(f"SHA-1: {sha1}")
    print(f"Wrote {(UPDATES_DIR / 'updates.xri').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
