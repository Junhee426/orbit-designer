from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from .constants import R_EARTH_KM
from .tle import julian_date as _julian_date

"""Eclipse geometry: low-precision solar position, cylindrical Earth-shadow test,
and the analytic orbit-average eclipse fraction from an orbit's beta angle.

Scope note: this covers eclipse *geometry* only (when/how often a satellite is in
shadow). It intentionally does not model battery state-of-charge, solar-array
sizing, or thermal response, since those require vehicle-specific inputs (array
area/efficiency, bus power draw, battery capacity) that are not part of this
service's constellation model; adding them without real inputs would just be
fabricated precision.
"""


def sun_unit_vector_eci(dt: datetime) -> np.ndarray:
    """Low-precision (~0.01 deg) geometric solar position, per the Astronomical Almanac's
    low-precision formulas. Good enough for eclipse timing; not for precision ephemeris."""
    jd = _julian_date(dt)
    t = (jd - 2451545.0) / 36525.0
    mean_lon = math.radians((280.460 + 36000.771 * t) % 360.0)
    mean_anom = math.radians((357.5291092 + 35999.05034 * t) % 360.0)
    ecl_lon = (
        mean_lon
        + math.radians(1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(mean_anom)
        + math.radians(0.019993 - 0.000101 * t) * math.sin(2 * mean_anom)
    )
    obliquity = math.radians(23.439291 - 0.0130042 * t)
    x = math.cos(ecl_lon)
    y = math.cos(obliquity) * math.sin(ecl_lon)
    z = math.sin(obliquity) * math.sin(ecl_lon)
    return np.array([x, y, z], dtype=float)


def sun_ra_dec_deg(sun_unit: np.ndarray) -> tuple[float, float]:
    ra = math.degrees(math.atan2(sun_unit[1], sun_unit[0])) % 360.0
    dec = math.degrees(math.asin(max(-1.0, min(1.0, sun_unit[2]))))
    return ra, dec


def instantaneous_eclipse(pos_eci_km: np.ndarray, sun_unit: np.ndarray) -> np.ndarray:
    """Cylindrical (umbra-only, no penumbra) shadow test on a spherical Earth."""
    along = pos_eci_km @ sun_unit
    perp = pos_eci_km - along[..., None] * sun_unit
    perp_dist = np.linalg.norm(perp, axis=-1)
    return (along < 0) & (perp_dist < R_EARTH_KM)


def beta_angle_deg(raan_deg: float, inclination_deg: float, sun_ra_deg: float, sun_dec_deg: float) -> float:
    """Angle between the orbital plane and the Earth-Sun line (Vallado 5-32)."""
    inc = math.radians(inclination_deg)
    raan = math.radians(raan_deg)
    ra_sun = math.radians(sun_ra_deg)
    dec_sun = math.radians(sun_dec_deg)
    sin_beta = math.cos(dec_sun) * math.sin(inc) * math.sin(raan - ra_sun) + math.sin(dec_sun) * math.cos(inc)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_beta))))


def orbit_eclipse_fraction(beta_deg: float, altitude_km: float) -> float:
    """Fraction of one orbital period spent in Earth's shadow for a circular orbit,
    under the cylindrical-shadow model. Zero once |beta| exceeds the critical angle
    at which the orbit clears Earth's shadow entirely."""
    r = R_EARTH_KM + float(altitude_km)
    if r <= R_EARTH_KM:
        return 0.0
    beta = math.radians(beta_deg)
    beta_star = math.asin(min(1.0, R_EARTH_KM / r))
    if abs(beta) >= beta_star:
        return 0.0
    cos_beta = math.cos(beta)
    if cos_beta <= 1e-12:
        return 0.0
    ratio = math.sqrt(max(0.0, r * r - R_EARTH_KM * R_EARTH_KM)) / (r * cos_beta)
    ratio = max(-1.0, min(1.0, ratio))
    return math.acos(ratio) / math.pi


def eclipse_geometry(raan_deg: float, inclination_deg: float, altitude_km: float, sun_unit: np.ndarray) -> dict:
    """Per-satellite orbit-average eclipse summary: beta angle, eclipse fraction, and
    the implied eclipse/sunlit duration for one orbital period."""
    from .orbit import orbital_period_s

    ra_sun, dec_sun = sun_ra_dec_deg(sun_unit)
    beta = beta_angle_deg(raan_deg, inclination_deg, ra_sun, dec_sun)
    fraction = orbit_eclipse_fraction(beta, altitude_km)
    period_min = orbital_period_s(altitude_km) / 60.0
    eclipse_min = fraction * period_min
    return {
        "beta_deg": beta,
        "orbit_eclipse_fraction": fraction,
        "eclipse_duration_min": eclipse_min,
        "sunlit_duration_min": period_min - eclipse_min,
    }
