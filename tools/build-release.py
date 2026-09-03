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
MASTER_MIXER_SOURCE = ROOT / "src" / "scripts" / "Astrogrm" / "MasterMixer.js"
PACKAGE_PREFIX = "astrogrm-scripts-v"
PACKAGE_MEMBER = "src/scripts/Astrogrm/MasterMixer.js"
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="release version, for example 0.1.0")
    return parser.parse_args()


def write_package(package_path: Path) -> None:
    source_bytes = MASTER_MIXER_SOURCE.read_bytes()
    member = ZipInfo(PACKAGE_MEMBER, date_time=(1980, 1, 1, 0, 0, 0))
    member.compress_type = ZIP_DEFLATED
    member.external_attr = 0o100644 << 16
    member.create_system = 3

    with ZipFile(package_path, "w") as archive:
        archive.writestr(member, source_bytes, compress_type=ZIP_DEFLATED, compresslevel=9)


def write_manifest(version: str, package_name: str, sha1: str) -> None:
    release_date = datetime.now(timezone.utc).strftime("%Y%m%d")
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
            <p>Installs Astrogrm Master Mixer v{version} for PixInsight 1.9.4 and later 1.9.x releases.</p>
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
    if not MASTER_MIXER_SOURCE.is_file():
        raise SystemExit(f"Missing source script: {MASTER_MIXER_SOURCE}")

    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    package_name = f"{PACKAGE_PREFIX}{args.version}.zip"
    package_path = UPDATES_DIR / package_name
    write_package(package_path)
    sha1 = hashlib.sha1(package_path.read_bytes()).hexdigest()
    write_manifest(args.version, package_name, sha1)

    print(f"Built {package_path.relative_to(ROOT)}")
    print(f"SHA-1: {sha1}")
    print(f"Wrote {(UPDATES_DIR / 'updates.xri').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
