from __future__ import annotations

import math
from typing import Iterable

import numpy as np

from .constants import MU_EARTH_KM3_S2
from .constellation import walker_elements
from .ground import elevation_and_range, ground_ecef
from .isl import active_isl_edges, segment_clears_earth
from .models import ConstellationConfig, GroundStation
from .orbit import eci_to_ecef, j2_raan_rate_rad_s, orbital_radius_km
from .tle import TLERecord, gmst_rad


def _xyz(v: np.ndarray) -> list[float]:
    return [float(v[0]), float(v[1]), float(v[2])]


def walker_orbit_paths(cfg: ConstellationConfig, t_sec: float, samples: int = 96) -> list[dict]:
    """Return one closed ECEF orbit polyline for each Walker plane.

    The path is an instantaneous rendering of the orbital plane at ``t_sec``.
    Earth rotation is therefore applied using the same epoch to every sampled
    point; this intentionally visualizes the orbit geometry rather than a
    ground track.
    """
    samples = max(24, min(int(samples), 360))
    _, _, raan0, _ = walker_elements(cfg)
    # First satellite of every plane has the plane RAAN.
    raan0 = raan0[:: cfg.sats_per_plane]
    rate = j2_raan_rate_rad_s(cfg.altitude_km, cfg.inclination_deg) if cfg.j2 else 0.0
    raans = raan0 + rate * t_sec
    inc = math.radians(cfg.inclination_deg)
    r = orbital_radius_km(cfg.altitude_km)
    u = np.linspace(0.0, 2.0 * math.pi, samples + 1)
    ci, si = math.cos(inc), math.sin(inc)
    result: list[dict] = []
    for p, raan in enumerate(raans):
        cO, sO = math.cos(float(raan)), math.sin(float(raan))
        cu, su = np.cos(u), np.sin(u)
        x = r * (cO * cu - sO * su * ci)
        y = r * (sO * cu + cO * su * ci)
        z = r * (su * si)
        eci = np.stack((x, y, z), axis=-1)
        ecef = eci_to_ecef(eci, t_sec)
        result.append({
            "id": f"orbit-plane-{p + 1:02d}",
            "plane": p + 1,
            "ecef_km": [_xyz(v) for v in ecef],
        })
    return result


def _rotate_orbit_pqw(points: np.ndarray, raan: float, inc: float, argp: float) -> np.ndarray:
    cO, sO = math.cos(raan), math.sin(raan)
    ci, si = math.cos(inc), math.sin(inc)
    cw, sw = math.cos(argp), math.sin(argp)
    # R3(Omega) R1(i) R3(omega)
    r11 = cO * cw - sO * sw * ci
    r12 = -cO * sw - sO * cw * ci
    r21 = sO * cw + cO * sw * ci
    r22 = -sO * sw + cO * cw * ci
    r31 = sw * si
    r32 = cw * si
    x = r11 * points[:, 0] + r12 * points[:, 1]
    y = r21 * points[:, 0] + r22 * points[:, 1]
    z = r31 * points[:, 0] + r32 * points[:, 1]
    return np.stack((x, y, z), axis=-1)


def tle_orbit_paths(records: Iterable[TLERecord], when, samples: int = 96, max_paths: int = 96) -> list[dict]:
    """Approximate instantaneous TLE orbit ellipses for visualization.

    SGP4 remains the source of truth for satellite positions.  These closed
    paths are generated from the TLE mean elements solely as a visual guide.
    """
    records = list(records)[: max(1, int(max_paths))]
    samples = max(24, min(int(samples), 360))
    nu = np.linspace(0.0, 2.0 * math.pi, samples + 1)
    theta = gmst_rad(when)
    ct, st = math.cos(theta), math.sin(theta)
    paths: list[dict] = []
    for rec in records:
        n = rec.mean_motion_rev_day * 2.0 * math.pi / 86400.0
        a = (MU_EARTH_KM3_S2 / (n * n)) ** (1.0 / 3.0)
        e = min(max(float(rec.eccentricity), 0.0), 0.99)
        radius = a * (1.0 - e * e) / (1.0 + e * np.cos(nu))
        pqw = np.stack((radius * np.cos(nu), radius * np.sin(nu), np.zeros_like(nu)), axis=-1)
        eci = _rotate_orbit_pqw(
            pqw,
            math.radians(rec.raan_deg),
            math.radians(rec.inclination_deg),
            math.radians(rec.arg_perigee_deg),
        )
        # TEME-like inertial geometry -> Earth-fixed rendering at this instant.
        x = ct * eci[:, 0] + st * eci[:, 1]
        y = -st * eci[:, 0] + ct * eci[:, 1]
        ecef = np.stack((x, y, eci[:, 2]), axis=-1)
        paths.append({
            "id": f"orbit-NORAD-{rec.norad_id}",
            "norad_id": rec.norad_id,
            "name": rec.name,
            "approximate": True,
            "ecef_km": [_xyz(v) for v in ecef],
        })
    return paths


def walker_isl_links(cfg: ConstellationConfig, positions_eci: np.ndarray, positions_ecef: np.ndarray, sat_ids: list[str], limit: int = 1024) -> list[dict]:
    links = []
    for e in active_isl_edges(cfg, positions_eci)[: max(0, int(limit))]:
        a, b = int(e["a"]), int(e["b"])
        links.append({
            "a_id": sat_ids[a],
            "b_id": sat_ids[b],
            "a_ecef_km": _xyz(positions_ecef[a]),
            "b_ecef_km": _xyz(positions_ecef[b]),
            "range_km": float(e["range_km"]),
            "propagation_ms": float(e["propagation_ms"]),
        })
    return links


def nearest_neighbor_isl_links(positions_inertial: np.ndarray, positions_ecef: np.ndarray, sat_ids: list[str], neighbors: int = 2, max_range_km: float = 6000.0, limit: int = 512) -> list[dict]:
    """Build a deterministic visualization-only ISL graph for arbitrary TLE sets."""
    p = np.asarray(positions_inertial, dtype=float)
    finite = np.all(np.isfinite(p), axis=1)
    edges: set[tuple[int, int]] = set()
    for i in range(len(p)):
        if not finite[i]:
            continue
        d = np.linalg.norm(p - p[i], axis=1)
        order = np.argsort(d)
        used = 0
        for j in order:
            j = int(j)
            if j == i or not finite[j] or not math.isfinite(float(d[j])):
                continue
            if float(d[j]) > max_range_km:
                break
            if segment_clears_earth(p[i], p[j]):
                edges.add(tuple(sorted((i, j))))
                used += 1
                if used >= neighbors:
                    break
    result = []
    for a, b in sorted(edges)[: max(0, int(limit))]:
        dist = float(np.linalg.norm(p[a] - p[b]))
        result.append({
            "a_id": sat_ids[a], "b_id": sat_ids[b],
            "a_ecef_km": _xyz(positions_ecef[a]), "b_ecef_km": _xyz(positions_ecef[b]),
            "range_km": dist,
        })
    return result


def access_links(positions_ecef: np.ndarray, sat_ids: list[str], stations: Iterable[GroundStation]) -> list[dict]:
    links: list[dict] = []
    for st in stations:
        elev, rng = elevation_and_range(positions_ecef, st)
        finite = np.isfinite(elev) & np.isfinite(rng)
        visible = np.where(finite & (elev >= st.min_elevation_deg))[0]
        station_xyz = ground_ecef(st.lat_deg, st.lon_deg)
        if len(visible) == 0:
            links.append({
                "station": st.name,
                "station_lat_deg": float(st.lat_deg),
                "station_lon_deg": float(st.lon_deg),
                "station_ecef_km": _xyz(station_xyz),
                "satellite_id": None,
                "visible": False,
            })
            continue
        best = int(visible[np.argmax(elev[visible])])
        links.append({
            "station": st.name,
            "station_lat_deg": float(st.lat_deg),
            "station_lon_deg": float(st.lon_deg),
            "station_ecef_km": _xyz(station_xyz),
            "satellite_id": sat_ids[best],
            "satellite_ecef_km": _xyz(positions_ecef[best]),
            "visible": True,
            "elevation_deg": float(elev[best]),
            "range_km": float(rng[best]),
        })
    return links
