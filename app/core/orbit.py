import math
import numpy as np
from .constants import MU_EARTH_KM3_S2, R_EARTH_KM, J2, OMEGA_EARTH_RAD_S, DEG2RAD


def orbital_radius_km(altitude_km: float) -> float:
    return R_EARTH_KM + altitude_km


def mean_motion_rad_s(altitude_km: float) -> float:
    a = orbital_radius_km(altitude_km)
    return math.sqrt(MU_EARTH_KM3_S2 / a**3)


def orbital_period_s(altitude_km: float) -> float:
    return 2.0 * math.pi / mean_motion_rad_s(altitude_km)


def j2_raan_rate_rad_s(altitude_km: float, inclination_deg: float) -> float:
    a = orbital_radius_km(altitude_km)
    n = mean_motion_rad_s(altitude_km)
    i = inclination_deg * DEG2RAD
    return -1.5 * J2 * n * (R_EARTH_KM / a) ** 2 * math.cos(i)


def rot_z(angle: np.ndarray) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    # Supports scalar angle only for explicit rotation matrix use.
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]], dtype=float)


def eci_to_ecef(r_eci: np.ndarray, t_sec: float) -> np.ndarray:
    theta = OMEGA_EARTH_RAD_S * t_sec
    c, s = math.cos(theta), math.sin(theta)
    x = c * r_eci[..., 0] + s * r_eci[..., 1]
    y = -s * r_eci[..., 0] + c * r_eci[..., 1]
    z = r_eci[..., 2]
    return np.stack((x, y, z), axis=-1)


def ecef_to_latlon(r_ecef: np.ndarray):
    x, y, z = r_ecef[..., 0], r_ecef[..., 1], r_ecef[..., 2]
    lon = np.arctan2(y, x)
    lat = np.arctan2(z, np.sqrt(x*x + y*y))
    return np.degrees(lat), np.degrees(lon)


def eci_to_ecef_angle(r_eci: np.ndarray, theta_rad: float) -> np.ndarray:
    """Rotate inertial vectors about Z by an explicit Earth rotation angle."""
    c, s = math.cos(theta_rad), math.sin(theta_rad)
    x = c * r_eci[..., 0] + s * r_eci[..., 1]
    y = -s * r_eci[..., 0] + c * r_eci[..., 1]
    z = r_eci[..., 2]
    return np.stack((x, y, z), axis=-1)
