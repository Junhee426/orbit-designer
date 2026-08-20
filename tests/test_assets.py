from pathlib import Path

from scripts.bootstrap_cesium import CESIUM_RELEASE_URL, CESIUM_VERSION, TARGET, install_cesium

STATIC = Path("app/static")


def test_required_local_visual_assets_exist_and_are_nonempty():
    for name in ["earth_blue_marble_2048.jpg", "kleo_satellite.glb", "kleo_satellite_compact.glb", "kleo_satellite_broadband.glb", "kleo_satellite_flatpanel.glb", "plotly.min.js"]:
        p = STATIC / name
        assert p.exists(), name
        assert p.stat().st_size > 1000, name


def test_cesium_bootstrap_dry_run_does_not_download(capsys):
    target = install_cesium(dry_run=True)
    out = capsys.readouterr().out
    assert target == TARGET
    assert CESIUM_VERSION in out
    assert CESIUM_RELEASE_URL in out


def test_satellite_glb_variants_are_valid_scenes():
    import trimesh
    names = [
        "kleo_satellite.glb",
        "kleo_satellite_compact.glb",
        "kleo_satellite_broadband.glb",
        "kleo_satellite_flatpanel.glb",
    ]
    for name in names:
        scene = trimesh.load(STATIC / name, force="scene")
        assert len(scene.geometry) >= 6
        assert scene.bounds is not None
