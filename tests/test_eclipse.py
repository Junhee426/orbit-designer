import math
from datetime import datetime, timezone

import numpy as np
import pytest

from app.core.constants import R_EARTH_KM
from app.core.eclipse import (
    beta_angle_deg,
    eclipse_geometry,
    instantaneous_eclipse,
    orbit_eclipse_fraction,
    sun_ra_dec_deg,
    sun_unit_vector_eci,
)


def test_sun_unit_vector_is_unit_length_across_a_year():
    for month in range(1, 13):
        dt = datetime(2026, month, 15, 12, tzinfo=timezone.utc)
        v = sun_unit_vector_eci(dt)
        assert math.isclose(float(np.linalg.norm(v)), 1.0, abs_tol=1e-9)


def test_sun_declination_swings_between_solstices():
    _, dec_solstice = sun_ra_dec_deg(sun_unit_vector_eci(datetime(2026, 6, 21, 12, tzinfo=timezone.utc)))
    _, dec_equinox = sun_ra_dec_deg(sun_unit_vector_eci(datetime(2026, 3, 20, 12, tzinfo=timezone.utc)))
    _, dec_winter = sun_ra_dec_deg(sun_unit_vector_eci(datetime(2026, 12, 21, 12, tzinfo=timezone.utc)))
    assert dec_solstice > 20
    assert dec_winter < -20
    assert abs(dec_equinox) < 3


def test_instantaneous_eclipse_flags_satellite_directly_behind_earth():
    sun_unit = np.array([1.0, 0.0, 0.0])
    r = R_EARTH_KM + 550.0
    behind_earth = np.array([[-r, 0.0, 0.0]])
    toward_sun = np.array([[r, 0.0, 0.0]])
    side_on = np.array([[0.0, r, 0.0]])
    assert instantaneous_eclipse(behind_earth, sun_unit)[0]
    assert not instantaneous_eclipse(toward_sun, sun_unit)[0]
    assert not instantaneous_eclipse(side_on, sun_unit)[0]


def test_beta_angle_is_bounded():
    for raan in range(0, 360, 30):
        for inc in (0, 42, 53, 90, 98, 180):
            beta = beta_angle_deg(raan, inc, sun_ra_deg=45.0, sun_dec_deg=10.0)
            assert -90.0 <= beta <= 90.0


def test_zero_beta_gives_the_maximum_eclipse_fraction_for_an_altitude():
    fractions = [orbit_eclipse_fraction(beta, 550.0) for beta in (0, 20, 40, 60, 80)]
    assert fractions == sorted(fractions, reverse=True)
    assert fractions[0] > 0.3


def test_eclipse_fraction_is_zero_beyond_the_critical_beta_angle():
    r = R_EARTH_KM + 550.0
    beta_star = math.degrees(math.asin(R_EARTH_KM / r))
    assert orbit_eclipse_fraction(beta_star + 0.5, 550.0) == 0.0
    assert orbit_eclipse_fraction(-beta_star - 0.5, 550.0) == 0.0
    assert orbit_eclipse_fraction(beta_star - 0.5, 550.0) > 0.0


def test_eclipse_fraction_requires_altitude_above_earth_surface():
    assert orbit_eclipse_fraction(0.0, -100.0) == 0.0


def test_eclipse_geometry_duration_adds_up_to_the_orbital_period():
    sun_unit = sun_unit_vector_eci(datetime(2026, 3, 20, 0, tzinfo=timezone.utc))
    geo = eclipse_geometry(raan_deg=10.0, inclination_deg=53.0, altitude_km=550.0, sun_unit=sun_unit)
    assert geo["eclipse_duration_min"] >= 0
    assert geo["sunlit_duration_min"] >= 0
    assert geo["orbit_eclipse_fraction"] == pytest.approx(
        geo["eclipse_duration_min"] / (geo["eclipse_duration_min"] + geo["sunlit_duration_min"]), rel=1e-9
    )
