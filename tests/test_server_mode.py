from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_server_version_and_headers():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.5.0"
    assert body["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "x-request-id" in r.headers
    assert r.headers["cache-control"] == "no-store"


def test_server_info_exposes_limits():
    r = client.get("/api/server-info")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.5.0"
    assert body["limits"]["max_satellites"] >= 256
    assert body["limits"]["max_heatmap_points"] >= 28


def test_public_server_rejects_oversized_constellation():
    r = client.post(
        "/api/snapshot",
        json={
            "mode": "walker",
            "planes": 128,
            "sats_per_plane": 256,
            "heatmap": False,
        },
    )
    assert r.status_code == 413
    assert "server limit" in r.json()["detail"]


def test_static_assets_get_cache_header():
    r = client.get("/static/kleo_satellite.glb")
    assert r.status_code == 200
    assert r.headers["cache-control"].startswith("public")


def test_robots_disallows_indexing():
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "Disallow: /" in r.text
