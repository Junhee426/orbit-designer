import math

import pytest

from app.core.constants import C_KM_S, R_EARTH_KM
from app.core.models import ConstellationConfig, GroundStation
from app.core.multishell import run_multi_shell_simulation


def _slant_range_at_five_degrees(altitude_km):
    radius = R_EARTH_KM + altitude_km
    return math.sqrt(
        radius * radius + R_EARTH_KM * R_EARTH_KM
        - 2 * radius * R_EARTH_KM * math.cos(math.radians(5))
    )


@pytest.mark.parametrize("min_elevation_deg,visible_count,nearest_altitude_km", [
    (20, 2, 500),
    (45, 1, 2000),
    (90, 0, None),
])
def test_multishell_minimum_delay_uses_nearest_visible_satellite(
    min_elevation_deg, visible_count, nearest_altitude_km,
):
    # At t=0 both satellites are above (0, 0). From (0, 5), the higher
    # satellite has greater elevation but the lower one has a shorter range.
    shells = [
        ("HIGH", "High", ConstellationConfig(2000, 0, 1, 1, 0, False)),
        ("LOW", "Low", ConstellationConfig(500, 0, 1, 1, 0, False)),
    ]
    station = GroundStation("Observer", 0, 5, min_elevation_deg)
    result = run_multi_shell_simulation(shells, [station], 1, 60)
    row = result["station_timelines"][0]

    assert row["visible_counts"][0] == visible_count
    if nearest_altitude_km is None:
        assert row["min_one_way_propagation_ms"][0] is None
        assert row["best_satellite_ids"][0] is None
        assert row["best_slant_range_km"][0] is None
        return

    expected_delay = 1000 * _slant_range_at_five_degrees(nearest_altitude_km) / C_KM_S
    assert row["min_one_way_propagation_ms"][0] == pytest.approx(expected_delay)
    assert row["best_satellite_ids"][0] == "HIGH-P01-S01"
    assert row["best_slant_range_km"][0] == pytest.approx(_slant_range_at_five_degrees(2000))
