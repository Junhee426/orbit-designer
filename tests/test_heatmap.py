import math
import numpy as np

from app.core.constants import R_EARTH_KM
from app.core.heatmap import instantaneous_coverage_heatmap, instantaneous_coverage_heatmaps
from app.core.models import ConstellationConfig
from app.core.snapshot import walker_snapshot


def ecef_at(lat_deg, lon_deg, altitude_km):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    r = R_EARTH_KM + altitude_km
    return np.array([r * math.cos(lat) * math.cos(lon), r * math.cos(lat) * math.sin(lon), r * math.sin(lat)])


def test_heatmap_detects_overhead_satellite():
    sat = np.array([ecef_at(37.0, 127.0, 500.0)])
    hm = instantaneous_coverage_heatmap(
        sat,
        min_elevation_deg=20,
        lat_min=36,
        lat_max=38,
        lon_min=126,
        lon_max=128,
        lat_points=5,
        lon_points=5,
    )
    assert hm["visible_counts"][2][2] == 1
    assert hm["max_visible"] == 1


def test_walker_snapshot_has_korean_peninsula_heatmap():
    snap = walker_snapshot(ConstellationConfig(888, 42, 16, 16, 1, True), 300, heatmap_points=16)
    assert len(snap["satellites"]) == 256
    assert len(snap["heatmap"]["lat_deg"]) == 16
    assert len(snap["heatmap"]["lon_deg"]) == 16
    assert snap["heatmap"]["max_visible"] >= 0


def test_multiple_service_area_heatmaps_are_independent():
    sat = np.array([ecef_at(37.0, 127.0, 500.0)])
    hms = instantaneous_coverage_heatmaps(sat, [
        {"code": "KOR", "name": "South Korea", "lat_min": 33, "lat_max": 39, "lon_min": 126, "lon_max": 130},
        {"code": "ARE", "name": "UAE", "lat_min": 22, "lat_max": 27, "lon_min": 51, "lon_max": 57},
    ], min_elevation_deg=20, points=8)
    assert len(hms) == 2
    assert hms[0]["area_code"] == "KOR"
    assert hms[1]["area_code"] == "ARE"
    assert len(hms[0]["visible_counts"]) == 8
