from __future__ import annotations

import math
import numpy as np

from .constants import R_EARTH_KM
from .constellation import satellite_positions_eci, satellite_ids
from .models import ConstellationConfig
from .orbit import eci_to_ecef, ecef_to_latlon


def footprint_central_angle_rad(altitude_km: float, min_elevation_deg: float) -> float:
    """Earth-central half angle of a spherical visibility footprint.

    Uses a spherical Earth and a minimum local elevation constraint.
    psi = acos((R/r) cos E) - E
    """
    r = R_EARTH_KM + float(altitude_km)
    e = math.radians(float(min_elevation_deg))
    if r <= R_EARTH_KM:
        raise ValueError("Satellite radius must exceed Earth radius.")
    # Direct line-of-sight cannot extend below the geometric horizon.
    e = min(max(e, 0.0), math.pi / 2.0)
    arg = (R_EARTH_KM / r) * math.cos(e)
    arg = min(1.0, max(-1.0, arg))
    return max(0.0, math.acos(arg) - e)


def footprint_radius_km(altitude_km: float, min_elevation_deg: float) -> float:
    return R_EARTH_KM * footprint_central_angle_rad(altitude_km, min_elevation_deg)


def footprint_polygon(lat_deg: float, lon_deg: float, altitude_km: float, min_elevation_deg: float, samples: int = 72) -> dict:
    samples = max(24, min(int(samples), 360))
    psi = footprint_central_angle_rad(altitude_km, min_elevation_deg)
    lat1 = math.radians(float(lat_deg))
    lon1 = math.radians(float(lon_deg))
    pts = []
    for bearing in np.linspace(0.0, 2.0 * math.pi, samples + 1):
        lat2 = math.asin(math.sin(lat1) * math.cos(psi) + math.cos(lat1) * math.sin(psi) * math.cos(float(bearing)))
        lon2 = lon1 + math.atan2(
            math.sin(float(bearing)) * math.sin(psi) * math.cos(lat1),
            math.cos(psi) - math.sin(lat1) * math.sin(lat2),
        )
        lon = (math.degrees(lon2) + 540.0) % 360.0 - 180.0
        pts.append([lon, math.degrees(lat2)])
    return {
        "min_elevation_deg": float(min_elevation_deg),
        "central_angle_deg": math.degrees(psi),
        "surface_radius_km": R_EARTH_KM * psi,
        "lon_lat_deg": pts,
    }


def _split_dateline(lon_lat: list[list[float]]) -> list[list[list[float]]]:
    if not lon_lat:
        return []
    segments = [[lon_lat[0]]]
    for p in lon_lat[1:]:
        if abs(float(p[0]) - float(segments[-1][-1][0])) > 180.0:
            segments.append([p])
        else:
            segments[-1].append(p)
    return [s for s in segments if len(s) >= 2]


def walker_ground_track(cfg: ConstellationConfig, satellite_id: str, center_t_sec: float, span_min: float = 220.0, samples: int = 181) -> dict:
    ids = satellite_ids(cfg)
    try:
        idx = ids.index(satellite_id)
    except ValueError as exc:
        raise ValueError(f"Unknown Walker satellite id: {satellite_id}") from exc
    samples = max(24, min(int(samples), 720))
    span_sec = max(1.0, float(span_min) * 60.0)
    times = np.linspace(float(center_t_sec) - span_sec / 2.0, float(center_t_sec) + span_sec / 2.0, samples)
    points = []
    for t in times:
        eci = satellite_positions_eci(cfg, float(t))[idx:idx+1]
        ecef = eci_to_ecef(eci, float(t))
        lat, lon = ecef_to_latlon(ecef)
        points.append([float(lon[0]), float(lat[0])])
    return {
        "satellite_id": satellite_id,
        "span_min": float(span_min),
        "samples": samples,
        "segments_lon_lat_deg": _split_dateline(points),
    }


def walker_orbital_geometry(cfg: ConstellationConfig, satellite_id: str, t_sec: float, min_elevation_deg: float = 20.0, ground_track_span_min: float = 220.0, ground_track_samples: int = 181, footprint_samples: int = 72) -> dict:
    ids = satellite_ids(cfg)
    try:
        idx = ids.index(satellite_id)
    except ValueError as exc:
        raise ValueError(f"Unknown Walker satellite id: {satellite_id}") from exc
    eci = satellite_positions_eci(cfg, float(t_sec))[idx:idx+1]
    ecef = eci_to_ecef(eci, float(t_sec))
    lat, lon = ecef_to_latlon(ecef)
    fp = footprint_polygon(float(lat[0]), float(lon[0]), cfg.altitude_km, min_elevation_deg, footprint_samples)
    fp.update({"satellite_id": satellite_id, "subsatellite_lon_deg": float(lon[0]), "subsatellite_lat_deg": float(lat[0])})
    return {
        "satellite_id": satellite_id,
        "ground_track": walker_ground_track(cfg, satellite_id, t_sec, ground_track_span_min, ground_track_samples),
        "footprint": fp,
    }
