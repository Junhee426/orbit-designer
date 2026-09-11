from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SHELLS = [
    {"id":"SH1","name":"Core","altitude_km":1280,"inclination_deg":42,"planes":2,"sats_per_plane":3,"phasing":1,"j2":True},
    {"id":"SH2","name":"Polar","altitude_km":600,"inclination_deg":70,"planes":2,"sats_per_plane":2,"phasing":1,"j2":True},
]


def test_multishell_snapshot_combines_satellites_and_orbit_paths():
    r = client.post('/api/snapshot', json={"mode":"multi_shell","shells":SHELLS,"time_sec":0,"heatmap":False})
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "multi_shell"
    assert len(d["satellites"]) == 10
    assert len(d["shells"]) == 2
    assert len(d["visualization"]["orbits"]) == 4
    assert d["satellites"][0]["id"].startswith("SH1-P")
    assert d["satellites"][-1]["id"].startswith("SH2-P")


def test_multishell_simulation_uses_combined_visibility():
    r = client.post('/api/multi-shell/simulate', json={
        "shells": SHELLS, "duration_min": 10, "step_sec": 60,
        "stations": [{"name":"Seoul","lat_deg":37.5665,"lon_deg":126.9780,"min_elevation_deg":20}],
    })
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "multi_shell"
    assert d["total_satellites"] == 10
    assert len(d["station_timelines"]) == 1
    assert len(d["station_timelines"][0]["times_sec"]) == 11


def test_orbital_geometry_api_for_walker_and_multishell():
    r = client.post('/api/orbital-geometry', json={
        "mode":"walker","satellite_id":"P01-S01","time_sec":0,
        "altitude_km":1280,"inclination_deg":42,"planes":8,"sats_per_plane":16,"phasing":1,"j2":True,
        "min_elevation_deg":20,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["footprint"]["surface_radius_km"] > 0
    assert d["ground_track"]["segments_lon_lat_deg"]

    r = client.post('/api/orbital-geometry', json={
        "mode":"multi_shell","shells":SHELLS,"satellite_id":"SH2-P01-S01","time_sec":0,"min_elevation_deg":20,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["shell_id"] == "SH2"
    assert d["footprint"]["satellite_id"] == "SH2-P01-S01"


def test_multishell_total_is_enforced_by_server_limit():
    huge = [{"id":"SH1","name":"Huge","altitude_km":1280,"inclination_deg":42,"planes":128,"sats_per_plane":256,"phasing":1,"j2":True}]
    r = client.post('/api/snapshot', json={"mode":"multi_shell","shells":huge,"heatmap":False})
    assert r.status_code == 413


def test_multishell_scenario_round_trip_preserves_editable_layer_values():
    shells = [
        {**SHELLS[0], "name": "기본층", "altitude_km": 888.5, "j2": False},
        {**SHELLS[1], "id": "SH3", "name": "보완층 복사", "phasing": 0},
    ]
    response = client.post('/api/scenario/validate', json={
        "configuration": {"mode": "multi_shell", "shells": shells, "heatmap": False},
        "selection": {"country_codes": ["KOR"], "cities_per_country": 1},
        "duration_min": 1, "step_sec": 60,
    })
    assert response.status_code == 200
    saved = response.json()
    assert saved["configuration"]["shells"] == shells
    restored = client.post('/api/scenario/validate', json=saved)
    assert restored.status_code == 200
    assert restored.json() == saved
    snapshot = client.post('/api/snapshot', json=restored.json()["configuration"])
    assert snapshot.status_code == 200
    assert {sat["shell_id"] for sat in snapshot.json()["satellites"]} == {"SH1", "SH3"}
