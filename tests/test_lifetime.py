import pytest

from app.core.lifetime import (
    DEFAULT_REENTRY_ALTITUDE_KM,
    atmospheric_density_kg_m3,
    orbital_lifetime_estimate,
)


def test_density_decreases_monotonically_with_altitude():
    altitudes = [0, 50, 100, 200, 300, 400, 500, 700, 900, 1000]
    densities = [atmospheric_density_kg_m3(a) for a in altitudes]
    assert densities == sorted(densities, reverse=True)
    assert all(d > 0 for d in densities)


def test_lifetime_decreases_as_altitude_increases():
    lifetimes = [orbital_lifetime_estimate(a)["lifetime_years"] for a in (300, 400, 550, 800)]
    assert all(v is not None for v in lifetimes)
    assert lifetimes == sorted(lifetimes)
    assert lifetimes[0] < lifetimes[-1]


def test_high_altitude_is_flagged_negligible_decay():
    result = orbital_lifetime_estimate(1200)
    assert result["negligible_decay"] is True
    assert result["lifetime_years"] is None


def test_altitude_already_at_or_below_reentry_gives_zero_lifetime():
    result = orbital_lifetime_estimate(DEFAULT_REENTRY_ALTITUDE_KM)
    assert result["lifetime_days"] == 0.0
    assert result["negligible_decay"] is False


def test_heavier_ballistic_coefficient_decays_faster():
    light = orbital_lifetime_estimate(500, area_to_mass_m2_per_kg=0.005)
    heavy = orbital_lifetime_estimate(500, area_to_mass_m2_per_kg=0.05)
    assert heavy["lifetime_years"] < light["lifetime_years"]
