from dataclasses import replace
import re

import pytest
from fastapi.testclient import TestClient

import app.main as main

from app.main import app


client = TestClient(app)


def test_health_server_version_and_headers():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.2.0"
    assert body["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "x-request-id" in r.headers
    assert r.headers["cache-control"] == "no-store"


def test_server_info_exposes_limits():
    r = client.get("/api/server-info")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.2.0"
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


@pytest.mark.parametrize("path", ["/static/app.js", "/static/workspace.css"])
def test_unversioned_code_is_revalidated_even_on_not_modified(path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"

    unchanged = client.get(path, headers={"If-None-Match": response.headers["etag"]})
    assert unchanged.status_code == 304
    assert unchanged.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/static/missing.js", "/static/missing.glb"])
def test_missing_static_assets_are_not_cached(path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"


def test_entry_page_changes_asset_url_when_code_changes(monkeypatch, tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text(
        '<link href="/static/workspace.css"><script src="/static/app.js"></script>',
        encoding="utf-8",
    )
    (static / "workspace.css").write_text("body { color: black; }", encoding="utf-8")
    script = static / "app.js"
    script.write_text("window.version = 1;", encoding="utf-8")
    monkeypatch.setattr(main, "BASE", tmp_path)

    def asset_urls():
        response = client.get("/")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        return re.findall(r'"(/static/[^\"]+)"', response.text)

    first = asset_urls()
    assert len(first) == 2
    assert all("?v=" in url for url in first)
    assert asset_urls() == first
    script.write_text("window.version = 2;", encoding="utf-8")
    second = asset_urls()
    assert second[0] == first[0]
    assert second[1] != first[1]


def test_route_work_is_rejected_before_computation(monkeypatch):
    monkeypatch.setattr(main, "SETTINGS", replace(main.SETTINGS, max_sim_work=1000))
    payload = dict(planes=4, sats_per_plane=8, duration_min=1, step_sec=60,
                   stations=[dict(name=f"S{i}", lat_deg=0, lon_deg=i) for i in range(8)])
    assert client.post("/api/simulate", json=payload).status_code == 200

    def unexpected_computation(_):
        pytest.fail("Oversized route requests must be rejected before simulation")

    monkeypatch.setattr(main, "run_simulation", unexpected_computation)
    response = client.post("/api/simulate", json={**payload, "include_routes": True})
    assert response.status_code == 413
    assert "Simulation workload" in response.json()["detail"]
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("station_count", [0, 1])
def test_routes_without_station_pairs_do_not_consume_extra_work(monkeypatch, station_count):
    monkeypatch.setattr(main, "SETTINGS", replace(main.SETTINGS, max_sim_work=64))
    response = client.post("/api/simulate", json=dict(
        planes=4, sats_per_plane=8, duration_min=1, step_sec=60, include_routes=True,
        stations=[dict(name="S", lat_deg=0, lon_deg=0)] * station_count,
    ))
    assert response.status_code == 200
    assert response.json()["station_pair_routes"] == []


def test_robots_disallows_indexing():
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "Disallow: /" in r.text
