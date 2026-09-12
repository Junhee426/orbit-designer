import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.tle import sgp4_available


client = TestClient(app)


def test_health_endpoint_reports_v14():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["version"] == "1.2.0"
    assert isinstance(payload["sgp4_available"], bool)


def test_kleo_preset_uses_test_orbit_defaults():
    response = client.get("/api/preset/k-leo")
    assert response.status_code == 200
    payload = response.json()
    assert payload["planes"] * payload["sats_per_plane"] == 128
    assert payload["altitude_km"] == 1280.0
    assert payload["planes"] == 8
    assert payload["inclination_deg"] == 42.0


def test_walker_snapshot_api_has_heatmap_and_satellite_properties():
    response = client.post("/api/snapshot", json={
        "mode": "walker",
        "time_sec": 600,
        "altitude_km": 888,
        "inclination_deg": 42,
        "planes": 16,
        "sats_per_plane": 16,
        "phasing": 1,
        "heatmap_points": 12,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "walker"
    assert len(data["satellites"]) == 256
    assert len(data["heatmap"]["visible_counts"]) == 12
    sat = data["satellites"][0]
    assert sat["source"] == "Walker"
    assert "raan_deg" in sat and "argument_latitude_deg" in sat
    viz = data["visualization"]
    assert len(viz["orbits"]) == 16
    assert len(viz["isl_links"]) > 0
    assert len(viz["access_links"]) == 3


def test_walker_snapshot_api_reports_eclipse_geometry():
    response = client.post("/api/snapshot", json={
        "mode": "walker",
        "time_sec": 0,
        "altitude_km": 550,
        "inclination_deg": 53,
        "planes": 4,
        "sats_per_plane": 4,
        "phasing": 1,
        "heatmap": False,
        "include_orbits": False,
        "include_isl": False,
        "include_access": False,
        "start_utc": "2026-03-20T00:00:00Z",
    })
    assert response.status_code == 200
    data = response.json()
    eclipse = data["eclipse"]
    assert eclipse["epoch_utc"] == "2026-03-20T00:00:00Z"
    assert eclipse["sunlit_count"] + eclipse["eclipsed_count"] == len(data["satellites"])
    sat = data["satellites"][0]
    assert isinstance(sat["eclipsed"], bool)
    assert 0.0 <= sat["orbit_eclipse_fraction"] <= 1.0
    assert -90.0 <= sat["beta_deg"] <= 90.0
    assert sat["eclipse_duration_min"] + sat["sunlit_duration_min"] == pytest.approx(sat["period_min"], rel=1e-6)


def test_multi_shell_snapshot_api_reports_eclipse_geometry():
    response = client.post("/api/snapshot", json={
        "mode": "multi_shell",
        "time_sec": 0,
        "heatmap": False,
        "include_orbits": False,
        "include_isl": False,
        "include_access": False,
        "start_utc": "2026-03-20T00:00:00Z",
        "shells": [
            {"id": "SH1", "altitude_km": 550, "inclination_deg": 53, "planes": 4, "sats_per_plane": 4, "phasing": 1},
            {"id": "SH2", "altitude_km": 600, "inclination_deg": 70, "planes": 3, "sats_per_plane": 3, "phasing": 1},
        ],
    })
    assert response.status_code == 200
    data = response.json()
    eclipse = data["eclipse"]
    assert eclipse["sunlit_count"] + eclipse["eclipsed_count"] == len(data["satellites"])
    assert all("eclipsed" in s and "beta_deg" in s for s in data["satellites"])


def test_tle_parse_api_works_without_requiring_propagation_runtime():
    tle = (
        "VANGUARD 1\n"
        "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
        "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
    )
    response = client.post("/api/tle/parse", json={"tle_text": tle})
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["satellites"][0]["norad_id"] == "00005"
    assert data["sgp4_available"] is sgp4_available()


def test_tle_snapshot_api_runtime_behavior():
    tle = (
        "VANGUARD 1\n"
        "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
        "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
    )
    response = client.post("/api/snapshot", json={
        "mode": "tle",
        "tle_text": tle,
        "time_sec": 0,
        "heatmap_points": 8,
    })
    if sgp4_available():
        assert response.status_code == 200
        data = response.json()
        assert data["mode"] == "tle"
        assert data["satellites"][0]["norad_id"] == "00005"
    else:
        assert response.status_code == 503
        assert "uv sync" in response.json()["detail"]


def test_visualization_config_and_local_assets():
    response = client.get("/api/visualization/config")
    assert response.status_code == 200
    cfg = response.json()
    assert cfg["cesium_version"] == "1.144"
    assert cfg["offline_imagery_url"].endswith("earth_blue_marble_2048.jpg")
    assert cfg["satellite_model_url"].endswith("kleo_satellite.glb")
    assert "World_Imagery" in cfg["online_imagery_url"]
    assert "ne_50m_admin_0_countries.geojson" in cfg["natural_earth_remote_url"]
    assert client.get(cfg["boundary_fallback_url"]).status_code == 200
    assert client.get(cfg["offline_imagery_url"]).status_code == 200
    assert client.get(cfg["satellite_model_url"]).status_code == 200


def test_service_region_catalog_and_resolver_api():
    c = client.get("/api/service-regions/catalog")
    assert c.status_code == 200
    cat = c.json()
    assert any(x["code"] == "KOR" for x in cat["countries"])
    assert any(x["code"] == "SEA" for x in cat["regions"])
    r = client.post("/api/service-regions/resolve", json={
        "country_codes": ["KOR", "ARE", "SGP"],
        "cities_per_country": 2,
        "min_elevation_deg": 20,
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data["coverage_areas"]) == 3
    assert any(x["name"] == "Dubai" for x in data["stations"])


def test_walker_snapshot_supports_multiple_country_coverage_tiles():
    areas = [
        {"code": "KOR", "name": "South Korea", "lon_min": 126, "lat_min": 33, "lon_max": 130, "lat_max": 39},
        {"code": "ARE", "name": "UAE", "lon_min": 51.4, "lat_min": 22.3, "lon_max": 56.6, "lat_max": 26.3},
        {"code": "SGP", "name": "Singapore", "lon_min": 103.55, "lat_min": 1.1, "lon_max": 104.1, "lat_max": 1.55},
    ]
    response = client.post("/api/snapshot", json={
        "mode": "walker", "time_sec": 0, "heatmap_points": 8,
        "coverage_areas": areas,
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data["heatmaps"]) == 3
    assert [x["area_code"] for x in data["heatmaps"]] == ["KOR", "ARE", "SGP"]


def test_orbit_lifetime_api_decreases_with_altitude():
    low = client.post("/api/orbit-lifetime", json={"altitude_km": 350}).json()
    high = client.post("/api/orbit-lifetime", json={"altitude_km": 800}).json()
    assert low["negligible_decay"] is False
    assert high["negligible_decay"] is False
    assert low["lifetime_years"] < high["lifetime_years"]


def test_orbit_lifetime_api_flags_high_altitude_as_negligible():
    response = client.post("/api/orbit-lifetime", json={"altitude_km": 1500})
    assert response.status_code == 200
    data = response.json()
    assert data["negligible_decay"] is True
    assert data["lifetime_years"] is None


def test_orbit_lifetime_api_rejects_out_of_range_inputs():
    response = client.post("/api/orbit-lifetime", json={"altitude_km": 550, "drag_coefficient": -1})
    assert response.status_code == 422


def test_walker_snapshot_includes_orbit_lifetime_estimate():
    response = client.post("/api/snapshot", json={
        "mode": "walker", "time_sec": 0, "altitude_km": 400, "heatmap": False,
        "include_orbits": False, "include_isl": False, "include_access": False,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["orbit_lifetime_estimate"]["negligible_decay"] is False
    assert data["orbit_lifetime_estimate"]["lifetime_years"] > 0


def test_multi_shell_snapshot_includes_per_shell_lifetime_estimate():
    response = client.post("/api/snapshot", json={
        "mode": "multi_shell", "time_sec": 0, "heatmap": False,
        "include_orbits": False, "include_isl": False, "include_access": False,
        "shells": [
            {"id": "SH1", "altitude_km": 400, "inclination_deg": 53, "planes": 2, "sats_per_plane": 2, "phasing": 1},
            {"id": "SH2", "altitude_km": 1200, "inclination_deg": 70, "planes": 2, "sats_per_plane": 2, "phasing": 1},
        ],
    })
    assert response.status_code == 200
    data = response.json()
    shells = {s["id"]: s for s in data["shells"]}
    assert shells["SH1"]["orbit_lifetime_estimate"]["negligible_decay"] is False
    assert shells["SH2"]["orbit_lifetime_estimate"]["negligible_decay"] is True
