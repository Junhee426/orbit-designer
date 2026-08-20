from fastapi.testclient import TestClient

from app.main import app
from app.core.tle import sgp4_available


client = TestClient(app)


def test_health_endpoint_reports_v14():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["version"] == "1.5.0"
    assert isinstance(payload["sgp4_available"], bool)


def test_kleo_preset_is_256_satellites():
    response = client.get("/api/preset/k-leo")
    assert response.status_code == 200
    payload = response.json()
    assert payload["planes"] * payload["sats_per_plane"] == 256
    assert payload["altitude_km"] == 888.0
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


def test_tle_parse_api_works_without_requiring_propagation_runtime():
    tle = (
        "VANGUARD 1\n"
        "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
        "2 00005  34.2682 331.5174 1849677 331.7664  19.3264 10.82419157413667"
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
        "2 00005  34.2682 331.5174 1849677 331.7664  19.3264 10.82419157413667"
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
