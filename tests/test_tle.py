from datetime import timezone

import numpy as np
import pytest

from app.core import tle as tle_module
from app.core.tle import parse_tle_text, propagate_tles, sgp4_available


TLE_TEXT = (
    "VANGUARD 1\n"
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
    "2 00005  34.2682 331.5174 1849677 331.7664  19.3264 10.82419157413667"
)


def test_parse_tle_metadata_and_epoch():
    rec = parse_tle_text(TLE_TEXT)[0]
    assert rec.name == "VANGUARD 1"
    assert rec.norad_id == "00005"
    assert rec.epoch_utc.tzinfo == timezone.utc
    assert rec.epoch_utc.year == 2000
    assert abs(rec.inclination_deg - 34.2682) < 1e-8
    assert abs(rec.eccentricity - 0.1849677) < 1e-10
    assert 130 < rec.orbital_period_min < 140


def test_parse_two_line_group_without_name():
    lines = "\n".join(TLE_TEXT.splitlines()[1:])
    rec = parse_tle_text(lines)[0]
    assert rec.name == "SAT-00005"


def test_sgp4_adapter_wiring_with_fake_runtime(monkeypatch):
    class FakeSat:
        @classmethod
        def twoline2rv(cls, l1, l2):
            return cls()
        def sgp4(self, jd, fr):
            return 0, (7000.0, 0.0, 0.0), (0.0, 7.5, 1.0)

    monkeypatch.setattr(tle_module, "Satrec", FakeSat)
    monkeypatch.setattr(tle_module, "jday", lambda *args: (2451545.0, 0.25))
    rec = parse_tle_text(TLE_TEXT)[0]
    out = propagate_tles([rec], rec.epoch_utc)
    assert out["teme_km"].shape == (1, 3)
    assert np.allclose(out["teme_km"][0], [7000, 0, 0])
    assert out["errors"] == []


@pytest.mark.skipif(not sgp4_available(), reason="sgp4 runtime is installed by uv sync, but unavailable in this sandbox")
def test_official_sgp4_vanguard_epoch_reference_vector():
    rec = parse_tle_text(TLE_TEXT)[0]
    out = propagate_tles([rec], rec.epoch_utc)
    expected = np.array([7022.46529266, -1400.08296755, 0.03995155])
    assert np.linalg.norm(out["teme_km"][0] - expected) < 1e-3


def test_gmst_at_j2000_reference_angle():
    from datetime import datetime
    from app.core.tle import gmst_rad
    angle_deg = np.degrees(gmst_rad(datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc))) % 360.0
    assert abs(angle_deg - 280.46061837) < 1e-8


def test_teme_to_ecef_rotation_preserves_radius():
    from app.core.tle import teme_to_ecef
    rec = parse_tle_text(TLE_TEXT)[0]
    r = np.array([[7000.0, -1200.0, 300.0]])
    ecef = teme_to_ecef(r, rec.epoch_utc)
    assert abs(np.linalg.norm(ecef[0]) - np.linalg.norm(r[0])) < 1e-9
