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
