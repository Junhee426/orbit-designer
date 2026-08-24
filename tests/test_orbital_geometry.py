import math

from app.core.geometry import footprint_central_angle_rad, footprint_polygon, walker_ground_track
from app.core.models import ConstellationConfig


def test_footprint_angle_matches_horizon_limit_and_shrinks_with_elevation_mask():
    horizon = footprint_central_angle_rad(1280.0, 0.0)
    expected = math.acos(6378.137 / (6378.137 + 1280.0))
    assert math.isclose(horizon, expected, rel_tol=0, abs_tol=1e-12)
    assert footprint_central_angle_rad(1280.0, 20.0) < horizon
    assert footprint_central_angle_rad(1280.0, 40.0) < footprint_central_angle_rad(1280.0, 20.0)


def test_footprint_polygon_is_closed_and_has_physical_radius():
    fp = footprint_polygon(37.5665, 126.9780, 1280.0, 20.0, 72)
    assert len(fp["lon_lat_deg"]) == 73
    assert fp["lon_lat_deg"][0] == fp["lon_lat_deg"][-1]
    assert 1900 < fp["surface_radius_km"] < 2200
    assert 0 < fp["central_angle_deg"] < 30


def test_walker_ground_track_returns_dateline_safe_segments():
    cfg = ConstellationConfig(1280, 42, 8, 16, 1, True)
    gt = walker_ground_track(cfg, "P01-S01", 0.0, span_min=220, samples=181)
    assert gt["samples"] == 181
    assert len(gt["segments_lon_lat_deg"]) >= 1
    assert sum(len(x) for x in gt["segments_lon_lat_deg"]) >= 175
    for seg in gt["segments_lon_lat_deg"]:
        for a, b in zip(seg, seg[1:]):
            assert abs(a[0] - b[0]) <= 180.0
