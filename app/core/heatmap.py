from __future__ import annotations

from typing import Iterable

import numpy as np

from .constants import DEG2RAD, R_EARTH_KM


def _ground_grid(lat_values: np.ndarray, lon_values: np.ndarray) -> np.ndarray:
    lat2, lon2 = np.meshgrid(lat_values * DEG2RAD, lon_values * DEG2RAD, indexing="ij")
    clat = np.cos(lat2)
    x = R_EARTH_KM * clat * np.cos(lon2)
    y = R_EARTH_KM * clat * np.sin(lon2)
    z = R_EARTH_KM * np.sin(lat2)
    return np.stack((x, y, z), axis=-1)


def instantaneous_coverage_heatmap(
    sat_ecef_km: np.ndarray,
    min_elevation_deg: float = 20.0,
    lat_min: float = 32.0,
    lat_max: float = 43.5,
    lon_min: float = 123.0,
    lon_max: float = 132.5,
    lat_points: int = 28,
    lon_points: int = 28,
    area_code: str | None = None,
    area_name: str | None = None,
) -> dict:
    """Visible-satellite count over a configurable latitude/longitude grid."""
    lat_points = int(np.clip(lat_points, 4, 80))
    lon_points = int(np.clip(lon_points, 4, 80))
    if lat_max <= lat_min or lon_max <= lon_min:
        raise ValueError("Heat-map maximum bounds must exceed minimum bounds.")
    lat = np.linspace(lat_min, lat_max, lat_points)
    lon = np.linspace(lon_min, lon_max, lon_points)
    ground = _ground_grid(lat, lon)
    zenith = ground / R_EARTH_KM

    sat = np.asarray(sat_ecef_km, dtype=float)
    valid = np.all(np.isfinite(sat), axis=1)
    sat = sat[valid]
    if sat.size == 0:
        counts = np.zeros((lat_points, lon_points), dtype=int)
    else:
        los = sat[None, None, :, :] - ground[:, :, None, :]
        rng = np.linalg.norm(los, axis=-1)
        sin_el = np.sum(los * zenith[:, :, None, :], axis=-1) / np.maximum(rng, 1e-12)
        min_sin = np.sin(np.deg2rad(min_elevation_deg))
        counts = np.sum(sin_el >= min_sin, axis=-1)
    return {
        "area_code": area_code,
        "area_name": area_name,
        "bounds": {"lon_min": float(lon_min), "lat_min": float(lat_min), "lon_max": float(lon_max), "lat_max": float(lat_max)},
        "lat_deg": lat.tolist(),
        "lon_deg": lon.tolist(),
        "visible_counts": counts.astype(int).tolist(),
        "min_elevation_deg": float(min_elevation_deg),
        "max_visible": int(counts.max()) if counts.size else 0,
        "mean_visible": float(counts.mean()) if counts.size else 0.0,
    }


def instantaneous_coverage_heatmaps(
    sat_ecef_km: np.ndarray,
    areas: Iterable[dict] | None,
    min_elevation_deg: float = 20.0,
    points: int = 28,
) -> list[dict]:
    """Calculate independent heatmaps for each service area.

    Multiple independent grids are deliberately used so separated service countries
    (for example Korea + UAE + Singapore) do not force a huge mostly-unused grid.
    """
    areas = list(areas or [])
    if not areas:
        return [instantaneous_coverage_heatmap(
            sat_ecef_km,
            min_elevation_deg=min_elevation_deg,
            lat_points=points,
            lon_points=points,
            area_code="KOR_DEFAULT",
            area_name="Korean Peninsula",
        )]
    result = []
    for area in areas:
        result.append(instantaneous_coverage_heatmap(
            sat_ecef_km,
            min_elevation_deg=min_elevation_deg,
            lat_min=float(area["lat_min"]),
            lat_max=float(area["lat_max"]),
            lon_min=float(area["lon_min"]),
            lon_max=float(area["lon_max"]),
            lat_points=points,
            lon_points=points,
            area_code=str(area.get("code") or "CUSTOM"),
            area_name=str(area.get("name") or area.get("name_ko") or "Service area"),
        ))
    return result
