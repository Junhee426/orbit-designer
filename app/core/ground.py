import math
import numpy as np
from .constants import R_EARTH_KM
from .models import GroundStation


def ground_ecef(lat_deg: float, lon_deg: float) -> np.ndarray:
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    cl = math.cos(lat)
    return R_EARTH_KM * np.array([cl * math.cos(lon), cl * math.sin(lon), math.sin(lat)], dtype=float)


def elevation_and_range(sat_ecef: np.ndarray, station: GroundStation):
    g = ground_ecef(station.lat_deg, station.lon_deg)
    los = sat_ecef - g
    rng = np.linalg.norm(los, axis=-1)
    zenith = g / np.linalg.norm(g)
    sin_el = np.sum(los * zenith, axis=-1) / rng
    sin_el = np.clip(sin_el, -1.0, 1.0)
    elev = np.degrees(np.arcsin(sin_el))
    return elev, rng


def stations_ecef(stations) -> np.ndarray:
    """ECEF positions for a list of ground stations, stacked as (S, 3)."""
    lat = np.radians([s.lat_deg for s in stations])
    lon = np.radians([s.lon_deg for s in stations])
    cl = np.cos(lat)
    return R_EARTH_KM * np.stack((cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)), axis=-1)


def elevation_and_range_grid(sat_ecef: np.ndarray, station_ecef: np.ndarray):
    """Elevation (deg) and range (km) of every satellite from every station.

    sat_ecef has shape (..., N, 3); station_ecef has shape (S, 3). The station
    axis is inserted before the satellite axis, so results broadcast to
    (..., S, N) for any number of leading (e.g. time) dimensions.
    """
    g = station_ecef[:, None, :]
    zenith = g / R_EARTH_KM
    los = sat_ecef[..., None, :, :] - g
    rng = np.linalg.norm(los, axis=-1)
    sin_el = np.clip(np.sum(los * zenith, axis=-1) / rng, -1.0, 1.0)
    elev = np.degrees(np.arcsin(sin_el))
    return elev, rng
