from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.sampling import sample_count, sample_times, sampled_metrics
from app.main import app


@pytest.mark.parametrize("duration_min,step_sec,expected", [
    (2, 60, [0, 60, 120]),
    (2.5, 60, [0, 60, 120, 150]),
    (0.5, 60, [0, 30]),
    (0.125, 7.5, [0, 7.5]),
    (0.14, 1.2, [0, 1.2, 2.4, 3.6, 4.8, 6, 7.2, 8.4]),
    (0.097, 1.94, [0, 1.94, 3.88, 5.82]),
    (0.135, 1.35, [0, 1.35, 2.7, 4.05, 5.4, 6.75, 8.1]),
    (0.058, 1.16, [0, 1.16, 2.32, 3.48]),
])
def test_sampling_preserves_intervals_and_includes_endpoint_once(duration_min, step_sec, expected):
    times = sample_times(duration_min, step_sec)

    assert times.tolist() == pytest.approx(expected)
    assert sample_count(duration_min, step_sec) == len(times)
    assert times[-1] == duration_min * 60
    assert np.all(np.diff(times) > 0)
    metrics = sampled_metrics([None] * len(times), [0] * len(times), times)
    assert metrics["analysis_duration_sec"] == duration_min * 60
    assert metrics["max_sampled_outage_sec"] == duration_min * 60


@pytest.mark.parametrize("duration_min,expected_count", [
    (np.nextafter(0.14, 0), 8),
    (0.14, 8),
    (np.nextafter(0.14, 1), 9),
])
def test_sampling_count_agrees_at_adjacent_float_endpoints(duration_min, expected_count):
    times = sample_times(duration_min, 1.2)

    assert len(times) == sample_count(duration_min, 1.2) == expected_count
    assert times[0] == 0
    assert times[-1] == duration_min * 60
    assert np.all(np.diff(times) > 0)


@pytest.mark.parametrize("endpoint", [
    "/api/simulate", "/api/multi-shell/simulate", "/api/tle/simulate", "/api/trade-study",
])
def test_decimal_step_analysis_endpoints_succeed(endpoint):
    payload = dict(
        duration_min=0.14, step_sec=1.2,
        stations=[dict(name="Pole", lat_deg=90, lon_deg=0, min_elevation_deg=90)],
    )
    if endpoint == "/api/multi-shell/simulate":
        payload["shells"] = [dict(id="SH1", planes=1, sats_per_plane=1)]
    elif endpoint == "/api/tle/simulate":
        payload["tle_text"] = (Path(__file__).parents[1] / "examples/vanguard1_verification.tle").read_text()
    elif endpoint == "/api/trade-study":
        payload.update(altitudes_km=[888], inclinations_deg=[42], planes_list=[1], sats_per_plane_list=[1])
    else:
        payload.update(planes=1, sats_per_plane=1)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(endpoint, json=payload)

    assert response.status_code == 200, response.text
    result = response.json()
    if endpoint == "/api/trade-study":
        assert result["results"][0]["worst_sampled_outage_sec"] == pytest.approx(8.4)
    else:
        timeline = result["station_timelines"][0]
        assert timeline["times_sec"] == pytest.approx([0, 1.2, 2.4, 3.6, 4.8, 6, 7.2, 8.4])
        assert timeline["max_sampled_outage_sec"] == pytest.approx(8.4)
