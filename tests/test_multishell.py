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
