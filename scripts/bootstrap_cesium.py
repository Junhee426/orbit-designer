from __future__ import annotations

import argparse
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

CESIUM_VERSION = "1.144"
CESIUM_RELEASE_URL = f"https://github.com/CesiumGS/cesium/releases/download/{CESIUM_VERSION}/Cesium-{CESIUM_VERSION}.zip"
NATURAL_EARTH_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "app" / "static" / "vendor" / "cesium"
BOUNDARY_TARGET = ROOT / "app" / "static" / "ne_50m_admin_0_countries.geojson"


def install_cesium(force: bool = False, dry_run: bool = False) -> Path:
    """Install CesiumJS and Natural Earth country boundaries for offline UI use."""
    if dry_run:
        print(f"Would download: {CESIUM_RELEASE_URL}")
        print(f"Would install Build/Cesium -> {TARGET}")
        print(f"Would download: {NATURAL_EARTH_URL}")
        print(f"Would install country boundaries -> {BOUNDARY_TARGET}")
        return TARGET

    if force or not (TARGET / "Cesium.js").exists():
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="kleo-cesium-") as td:
            archive = Path(td) / f"Cesium-{CESIUM_VERSION}.zip"
            print(f"Downloading CesiumJS {CESIUM_VERSION}...")
            urllib.request.urlretrieve(CESIUM_RELEASE_URL, archive)
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(Path(td) / "extract")
            extracted = Path(td) / "extract"
            candidates = list(extracted.rglob("Build/Cesium/Cesium.js"))
            if not candidates:
                raise RuntimeError("Cesium Build/Cesium directory was not found in the downloaded archive.")
            source = candidates[0].parent
            if TARGET.exists():
                shutil.rmtree(TARGET)
            shutil.copytree(source, TARGET)
        if not (TARGET / "Cesium.js").exists() or not (TARGET / "Widgets" / "widgets.css").exists():
            raise RuntimeError("CesiumJS installation validation failed.")
        print(f"Installed CesiumJS {CESIUM_VERSION} at {TARGET}")
    else:
        print(f"CesiumJS {CESIUM_VERSION} is already installed at {TARGET}")

    if force or not BOUNDARY_TARGET.exists():
        print("Downloading Natural Earth 1:50m Admin-0 country boundaries...")
        BOUNDARY_TARGET.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(NATURAL_EARTH_URL, BOUNDARY_TARGET)
        if BOUNDARY_TARGET.stat().st_size < 100_000:
            raise RuntimeError("Natural Earth country-boundary download appears incomplete.")
        print(f"Installed Natural Earth boundaries at {BOUNDARY_TARGET}")
    else:
        print(f"Natural Earth boundaries are already installed at {BOUNDARY_TARGET}")
    return TARGET


def main() -> None:
    parser = argparse.ArgumentParser(description="Install CesiumJS + Natural Earth locally for fully offline K-LEO visualization.")
    parser.add_argument("--force", action="store_true", help="Replace existing local Cesium/Natural Earth assets.")
    parser.add_argument("--dry-run", action="store_true", help="Show source URLs and destinations without downloading.")
    args = parser.parse_args()
    install_cesium(force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
