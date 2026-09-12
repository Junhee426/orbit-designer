from __future__ import annotations

import math

from .constants import MU_EARTH_KM3_S2, R_EARTH_KM

"""Atmospheric drag / orbital-lifetime estimate for low-altitude circular orbits.

Uses the standard piecewise-exponential atmospheric density model (base altitude,
reference density, scale height per band) from Vallado, "Fundamentals of
Astrodynamics and Applications", Table 8-4 -- a public-domain textbook reference
model, not a live/forecast atmosphere. It ignores solar-cycle variation, diurnal
bulge, and attitude-dependent drag area, so treat the result as an order-of-
magnitude planning estimate, not a mission-design-grade lifetime prediction.
"""

# (base_altitude_km, reference_density_kg_m3, scale_height_km)
_ATMOSPHERE_BANDS = [
    (0.0, 1.225, 7.249),
    (25.0, 3.899e-2, 6.349),
    (30.0, 1.774e-2, 6.682),
    (40.0, 3.972e-3, 7.554),
    (50.0, 1.057e-3, 8.382),
    (60.0, 3.206e-4, 7.714),
    (70.0, 8.770e-5, 6.549),
    (80.0, 1.905e-5, 5.799),
    (90.0, 3.396e-6, 5.382),
    (100.0, 5.297e-7, 5.877),
    (110.0, 9.661e-8, 7.263),
    (120.0, 2.438e-8, 9.473),
    (130.0, 8.484e-9, 12.636),
    (140.0, 3.845e-9, 16.149),
    (150.0, 2.070e-9, 22.523),
    (180.0, 5.464e-10, 29.740),
    (200.0, 2.789e-10, 37.105),
    (250.0, 7.248e-11, 45.546),
    (300.0, 2.418e-11, 53.628),
    (350.0, 9.518e-12, 53.298),
    (400.0, 3.725e-12, 58.515),
    (450.0, 1.585e-12, 60.828),
    (500.0, 6.967e-13, 63.822),
    (600.0, 1.454e-13, 71.835),
    (700.0, 3.614e-14, 88.667),
    (800.0, 1.170e-14, 124.64),
    (900.0, 5.245e-15, 181.05),
    (1000.0, 3.019e-15, 268.00),
]

DEFAULT_DRAG_COEFFICIENT = 2.2
DEFAULT_AREA_TO_MASS_M2_PER_KG = 0.01  # a small-satellite-ish default; real spacecraft vary ~5x either way
DEFAULT_REENTRY_ALTITUDE_KM = 150.0
# Above this altitude, drag decay over any realistic mission life is negligible at our fidelity.
_NEGLIGIBLE_DECAY_ALTITUDE_KM = 1000.0
_MAX_LIFETIME_YEARS = 1000.0


def atmospheric_density_kg_m3(altitude_km: float) -> float:
    band = _ATMOSPHERE_BANDS[0]
    for candidate in _ATMOSPHERE_BANDS:
        if altitude_km >= candidate[0]:
            band = candidate
        else:
            break
    h0, rho0, scale_height = band
    return rho0 * math.exp(-(altitude_km - h0) / scale_height)


def orbital_lifetime_estimate(
    altitude_km: float,
    drag_coefficient: float = DEFAULT_DRAG_COEFFICIENT,
    area_to_mass_m2_per_kg: float = DEFAULT_AREA_TO_MASS_M2_PER_KG,
    reentry_altitude_km: float = DEFAULT_REENTRY_ALTITUDE_KM,
) -> dict:
    """Numerically integrates the secular semi-major-axis decay of a circular orbit
    due to atmospheric drag, stepping down in 1 km altitude increments until the
    orbit reaches reentry_altitude_km (or decay is judged negligible)."""
    if altitude_km <= reentry_altitude_km:
        return {
            "lifetime_days": 0.0,
            "lifetime_years": 0.0,
            "reentry_altitude_km": float(reentry_altitude_km),
            "negligible_decay": False,
            "note": "고도가 이미 재진입 기준 고도 이하입니다.",
        }
    if altitude_km >= _NEGLIGIBLE_DECAY_ALTITUDE_KM:
        return {
            "lifetime_days": None,
            "lifetime_years": None,
            "reentry_altitude_km": float(reentry_altitude_km),
            "negligible_decay": True,
            "note": f"{_NEGLIGIBLE_DECAY_ALTITUDE_KM:.0f} km 이상 고도는 이 모델의 신뢰 범위를 벗어나 대기항력 감쇠가 사실상 무시할 만한 수준입니다.",
        }

    ballistic_coefficient = drag_coefficient * area_to_mass_m2_per_kg  # m^2/kg
    mu_m3_s2 = MU_EARTH_KM3_S2 * 1e9
    r_earth_m = R_EARTH_KM * 1000.0
    step_km = 1.0
    total_seconds = 0.0
    h = float(altitude_km)
    max_seconds = _MAX_LIFETIME_YEARS * 365.25 * 86400.0
    while h > reentry_altitude_km and total_seconds < max_seconds:
        mid_h = h - step_km / 2.0
        rho = atmospheric_density_kg_m3(mid_h)
        a_m = r_earth_m + mid_h * 1000.0
        # da/dt (secular, near-circular orbit): Vallado eq. 8-33-style approximation.
        da_dt_m_s = -ballistic_coefficient * rho * math.sqrt(mu_m3_s2 * a_m)
        if da_dt_m_s >= 0:
            return {
                "lifetime_days": None,
                "lifetime_years": None,
                "reentry_altitude_km": float(reentry_altitude_km),
                "negligible_decay": True,
                "note": "이 고도에서는 대기항력 감쇠가 사실상 무시할 만한 수준입니다.",
            }
        dt = (-step_km * 1000.0) / da_dt_m_s
        total_seconds += dt
        h -= step_km

    if total_seconds >= max_seconds:
        return {
            "lifetime_days": None,
            "lifetime_years": None,
            "reentry_altitude_km": float(reentry_altitude_km),
            "negligible_decay": True,
            "note": f"추정 궤도수명이 {_MAX_LIFETIME_YEARS:.0f}년을 초과합니다.",
        }

    lifetime_days = total_seconds / 86400.0
    return {
        "lifetime_days": lifetime_days,
        "lifetime_years": lifetime_days / 365.25,
        "reentry_altitude_km": float(reentry_altitude_km),
        "negligible_decay": False,
        "note": "지수형 대기 모델(Vallado Table 8-4) 기반 개략 추정치입니다. 태양활동 주기, 자세에 따른 항력면적 변화는 반영하지 않습니다.",
    }
