import math
import numpy as np
from .constants import OMEGA_EARTH_RAD_S
from .models import ConstellationConfig
from .orbit import orbital_radius_km, mean_motion_rad_s, j2_raan_rate_rad_s, eci_to_ecef_angle


def walker_elements(cfg: ConstellationConfig):
    """Return arrays of plane index, sat index, RAAN and initial argument of latitude.

    Walker-Delta T/P/F convention:
      RAAN_p = 2*pi*p/P
      u_0(p,s) = 2*pi*s/S + 2*pi*F*p/T
    where T=P*S.
    """
    p_idx, s_idx, raan, u0 = [], [], [], []
    T = cfg.total_satellites
    for p in range(cfg.planes):
        for s in range(cfg.sats_per_plane):
            p_idx.append(p)
            s_idx.append(s)
            raan.append(2.0 * math.pi * p / cfg.planes)
            u0.append(2.0 * math.pi * s / cfg.sats_per_plane + 2.0 * math.pi * cfg.phasing * p / T)
    return (
        np.asarray(p_idx, dtype=int),
        np.asarray(s_idx, dtype=int),
        np.asarray(raan, dtype=float),
        np.asarray(u0, dtype=float),
    )


def satellite_positions_eci(cfg: ConstellationConfig, t_sec: float, elements=None) -> np.ndarray:
    if elements is None:
        elements = walker_elements(cfg)
    _, _, raan0, u0 = elements
    r = orbital_radius_km(cfg.altitude_km)
    n = mean_motion_rad_s(cfg.altitude_km)
    inc = math.radians(cfg.inclination_deg)
    if cfg.j2:
        raan = raan0 + j2_raan_rate_rad_s(cfg.altitude_km, cfg.inclination_deg) * t_sec
    else:
        raan = raan0
    u = u0 + n * t_sec

    cu, su = np.cos(u), np.sin(u)
    cO, sO = np.cos(raan), np.sin(raan)
    ci, si = math.cos(inc), math.sin(inc)

    # R3(RAAN) R1(i) [r cos u, r sin u, 0]
    x = r * (cO * cu - sO * su * ci)
    y = r * (sO * cu + cO * su * ci)
    z = r * (su * si)
    return np.stack((x, y, z), axis=-1)


def satellite_states_ecef(cfg: ConstellationConfig, times_sec: np.ndarray) -> np.ndarray:
    """ECEF positions for every satellite at every requested time, shape (T, N, 3).

    Vectorised equivalent of calling satellite_positions_eci()+eci_to_ecef()
    once per time step. Callers that need bounded memory (e.g.
    coverage.multi_station_summary, which broadcasts a station axis on top
    of this) should chunk times_sec themselves and accumulate the results.
    """
    _, _, raan0, u0 = walker_elements(cfg)
    r = orbital_radius_km(cfg.altitude_km)
    n = mean_motion_rad_s(cfg.altitude_km)
    inc = math.radians(cfg.inclination_deg)
    ci, si = math.cos(inc), math.sin(inc)
    rate = j2_raan_rate_rad_s(cfg.altitude_km, cfg.inclination_deg) if cfg.j2 else 0.0
    t = np.asarray(times_sec, dtype=float)[:, None]
    raan = raan0[None, :] + rate * t
    u = u0[None, :] + n * t
    cu, su = np.cos(u), np.sin(u)
    cO, sO = np.cos(raan), np.sin(raan)
    x = r * (cO * cu - sO * su * ci)
    y = r * (sO * cu + cO * su * ci)
    z = r * (su * si)
    eci = np.stack((x, y, z), axis=-1)
    return eci_to_ecef_angle(eci, OMEGA_EARTH_RAD_S * t)


def satellite_ids(cfg: ConstellationConfig, elements=None):
    if elements is None:
        elements = walker_elements(cfg)
    p, s, _, _ = elements
    return [f"P{pi+1:02d}-S{si+1:02d}" for pi, si in zip(p, s)]


def satellite_position_eci_single(cfg: ConstellationConfig, idx: int, t_sec: float) -> np.ndarray:
    """Position of exactly one satellite (shape (1, 3)), without rebuilding the whole constellation.

    Equivalent to satellite_positions_eci(cfg, t_sec)[idx:idx+1] but O(1) in constellation size,
    for call sites (e.g. per-sample ground-track loops) that only need a single satellite.
    """
    plane, slot = divmod(idx, cfg.sats_per_plane)
    total = cfg.total_satellites
    r = orbital_radius_km(cfg.altitude_km)
    n = mean_motion_rad_s(cfg.altitude_km)
    inc = math.radians(cfg.inclination_deg)
    raan0 = 2.0 * math.pi * plane / cfg.planes
    u0 = 2.0 * math.pi * slot / cfg.sats_per_plane + 2.0 * math.pi * cfg.phasing * plane / total
    if cfg.j2:
        raan = raan0 + j2_raan_rate_rad_s(cfg.altitude_km, cfg.inclination_deg) * t_sec
    else:
        raan = raan0
    u = u0 + n * t_sec

    cu, su = math.cos(u), math.sin(u)
    cO, sO = math.cos(raan), math.sin(raan)
    ci, si = math.cos(inc), math.sin(inc)

    x = r * (cO * cu - sO * su * ci)
    y = r * (sO * cu + cO * su * ci)
    z = r * (su * si)
    return np.array([[x, y, z]], dtype=float)
