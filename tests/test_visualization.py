from datetime import timezone

import numpy as np

from app.core.constellation import satellite_ids, satellite_positions_eci
from app.core.models import ConstellationConfig, GroundStation
from app.core.orbit import eci_to_ecef, orbital_radius_km
from app.core.tle import parse_tle_text
from app.core.visualization import access_links, tle_orbit_paths, walker_orbit_paths
from app.core.visualization import annotate_service_visibility
from app.core.constants import R_EARTH_KM
from app.core.snapshot import walker_snapshot, tle_snapshot
from app.core.multishell import multi_shell_snapshot

VANGUARD = (
    "VANGUARD 1\n"
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
    "2 00005  34.2682 331.5174 1849677 331.7664  19.3264 10.82419157413667"
)


def test_service_visibility_marks_all_candidates_and_resets_without_stations():
    r = R_EARTH_KM
    positions = np.array([[r + 500, 0, 0], [r + 1000, 0, 0], [-r - 500, 0, 0], [np.nan, 0, 0]])
    satellites = [{} for _ in positions]
    annotate_service_visibility(satellites, positions, [GroundStation("A", 0, 0, 90), GroundStation("B", 0, 180, 20)])
    assert [s["service_visible"] for s in satellites] == [True, True, True, False]
    assert [s["service_station_count"] for s in satellites] == [1, 1, 1, 0]
    annotate_service_visibility(satellites, positions, [])
    assert not any(s["service_visible"] for s in satellites)


def test_snapshot_service_visibility_is_independent_of_layers_for_all_modes():
    cfg = ConstellationConfig(888, 42, 8, 16, 1, True)
    options = dict(heatmap=False, include_access=False, include_isl=False, include_orbits=False)
    factories = [
        lambda stations: walker_snapshot(cfg, 600, stations=stations, **options),
        lambda stations: multi_shell_snapshot([("A", "Core", cfg)], 600, stations=stations, **options),
        lambda stations: tle_snapshot(VANGUARD, None, 0, stations=stations, **options),
    ]
    for factory in factories:
        first = factory([])["satellites"][0]
        station = GroundStation("Under satellite", first["lat_deg"], first["lon_deg"], 20)
        snap = factory([station])
        assert snap["satellites"][0]["service_visible"] is True
        assert snap["satellites"][0]["service_station_count"] == 1
        assert snap["visualization"]["access_links"] == []
        positions = np.array([[s["ecef_x_km"], s["ecef_y_km"], s["ecef_z_km"]] for s in snap["satellites"]])
        from app.core.ground import elevation_and_range
        elev, _ = elevation_and_range(positions, station)
        assert [s["service_visible"] for s in snap["satellites"]] == (elev >= 20).tolist()


def test_walker_orbit_paths_are_closed_and_match_orbital_radius():
    cfg = ConstellationConfig(888, 42, 16, 16, 1, True)
    paths = walker_orbit_paths(cfg, 600, samples=48)
    assert len(paths) == 16
    for path in paths:
        pts = np.asarray(path["ecef_km"])
        assert pts.shape == (49, 3)
        assert np.allclose(pts[0], pts[-1], atol=1e-7)
        assert np.allclose(np.linalg.norm(pts, axis=1), orbital_radius_km(888), atol=1e-6)


def test_access_link_selects_visible_satellite_for_seoul_kleo():
    cfg = ConstellationConfig(888, 42, 16, 16, 1, True)
    t = 600.0
    eci = satellite_positions_eci(cfg, t)
    ecef = eci_to_ecef(eci, t)
    st = GroundStation("Seoul", 37.5665, 126.9780, 20.0)
    links = access_links(ecef, satellite_ids(cfg), [st])
    assert len(links) == 1
    assert links[0]["station"] == "Seoul"
    assert links[0]["visible"] is True
    assert links[0]["elevation_deg"] >= 20.0
    assert links[0]["satellite_id"].startswith("P")


def test_tle_visual_orbit_is_closed_without_requiring_sgp4_runtime():
    record = parse_tle_text(VANGUARD)[0]
    when = record.epoch_utc.astimezone(timezone.utc)
    path = tle_orbit_paths([record], when, samples=48)[0]
    pts = np.asarray(path["ecef_km"])
    assert path["approximate"] is True
    assert pts.shape == (49, 3)
    assert np.all(np.isfinite(pts))
    assert np.allclose(pts[0], pts[-1], atol=1e-7)
