from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
from typing import Iterable

import numpy as np

from .constants import R_EARTH_KM

try:
    from sgp4.api import SGP4_ERRORS, Satrec, jday
except ImportError:  # pragma: no cover - exercised on machines without optional runtime dependency
    SGP4_ERRORS = {}
    Satrec = None
    jday = None


class SGP4UnavailableError(RuntimeError):
    pass


class TLEParseError(ValueError):
    pass


@dataclass(frozen=True)
class TLERecord:
    name: str
    line1: str
    line2: str
    norad_id: str
    epoch_utc: datetime
    inclination_deg: float
    raan_deg: float
    eccentricity: float
    arg_perigee_deg: float
    mean_anomaly_deg: float
    mean_motion_rev_day: float

    @property
    def orbital_period_min(self) -> float:
        return 1440.0 / self.mean_motion_rev_day


def sgp4_available() -> bool:
    return Satrec is not None and jday is not None


def _tle_epoch(line1: str) -> datetime:
    if len(line1) < 32:
        raise TLEParseError("TLE line 1 is too short to contain an epoch.")
    try:
        yy = int(line1[18:20])
        day_of_year = float(line1[20:32])
    except ValueError as exc:
        raise TLEParseError("Invalid TLE epoch field.") from exc
    year = 1900 + yy if yy >= 57 else 2000 + yy
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=day_of_year - 1.0)


def _record(name: str | None, line1: str, line2: str) -> TLERecord:
    if not line1.startswith("1 ") or not line2.startswith("2 "):
        raise TLEParseError("Each TLE must contain a line beginning with '1 ' followed by a line beginning with '2 '.")
    sat1 = line1[2:7].strip()
    sat2 = line2[2:7].strip()
    if not sat1 or sat1 != sat2:
        raise TLEParseError("TLE line 1 and line 2 satellite numbers do not match.")
    try:
        if len(line2) >= 63:
            inc = float(line2[8:16])
            raan = float(line2[17:25])
            ecc = float("0." + line2[26:33].replace(" ", "0"))
            argp = float(line2[34:42])
            ma = float(line2[43:51])
            mm = float(line2[52:63])
        else:
            parts = line2.split()
            if len(parts) < 8:
                raise ValueError("short TLE line 2")
            inc = float(parts[2])
            raan = float(parts[3])
            ecc = float("0." + parts[4].strip())
            argp = float(parts[5])
            ma = float(parts[6])
            mm = float(parts[7])
    except ValueError as exc:
        raise TLEParseError("Invalid numeric field in TLE line 2.") from exc
    if mm <= 0.0:
        raise TLEParseError("TLE mean motion must be positive.")
    return TLERecord(
        name=(name or f"SAT-{sat1}").strip(),
        line1=line1.rstrip(),
        line2=line2.rstrip(),
        norad_id=sat1,
        epoch_utc=_tle_epoch(line1),
        inclination_deg=inc,
        raan_deg=raan,
        eccentricity=ecc,
        arg_perigee_deg=argp,
        mean_anomaly_deg=ma,
        mean_motion_rev_day=mm,
    )


def parse_tle_text(text: str) -> list[TLERecord]:
    """Parse 2-line or 3-line TLE groups.

    A non-empty line preceding a '1 ' line is treated as the satellite name.
    Blank lines are ignored. Two-line groups without a name receive SAT-<NORAD>.
    """
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    records: list[TLERecord] = []
    i = 0
    pending_name: str | None = None
    while i < len(lines):
        line = lines[i]
        if line.startswith("1 "):
            if i + 1 >= len(lines):
                raise TLEParseError("TLE line 1 is missing its line 2.")
            line2 = lines[i + 1]
            records.append(_record(pending_name, line, line2))
            pending_name = None
            i += 2
        elif line.startswith("2 "):
            raise TLEParseError("Unexpected TLE line 2 without a preceding line 1.")
        else:
            pending_name = line
            i += 1
    if pending_name is not None:
        raise TLEParseError("A satellite name was provided without following TLE lines.")
    if not records:
        raise TLEParseError("No TLE records found.")
    return records


def julian_date(dt: datetime) -> float:
    """UTC datetime to Julian Date, independent of the sgp4 package."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    y, m = dt.year, dt.month
    d = dt.day + (dt.hour + (dt.minute + (dt.second + dt.microsecond / 1e6) / 60.0) / 60.0) / 24.0
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5


def gmst_rad(dt: datetime) -> float:
    """Approximate Greenwich mean sidereal angle for TEME->Earth-fixed display rotation."""
    jd = julian_date(dt)
    t = (jd - 2451545.0) / 36525.0
    theta_deg = (
        280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * t * t
        - (t * t * t) / 38710000.0
    )
    return math.radians(theta_deg % 360.0)


def teme_to_ecef(r_teme_km: np.ndarray, dt: datetime) -> np.ndarray:
    """TEME position to a rotating Earth-fixed frame for visualization/coverage.

    This uses a GMST Z-rotation and intentionally omits polar motion and small
    equation-of-equinoxes corrections. It is appropriate for constellation UI
    visualization and coverage screening, not precision orbit determination.
    """
    theta = gmst_rad(dt)
    c, s = math.cos(theta), math.sin(theta)
    x = c * r_teme_km[..., 0] + s * r_teme_km[..., 1]
    y = -s * r_teme_km[..., 0] + c * r_teme_km[..., 1]
    z = r_teme_km[..., 2]
    return np.stack((x, y, z), axis=-1)


def _split_jd(dt: datetime) -> tuple[float, float]:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    if jday is None:
        raise SGP4UnavailableError("SGP4 package is not installed. Run 'uv sync' to install sgp4.")
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
    return float(jd), float(fr)


def propagate_tles(records: Iterable[TLERecord], dt: datetime) -> dict:
    if not sgp4_available():
        raise SGP4UnavailableError("SGP4 package is not installed. Run 'uv sync' to install sgp4>=2.27.")
    records = list(records)
    jd, fr = _split_jd(dt)
    pos_teme, vel_teme, errors = [], [], []
    for rec in records:
        sat = Satrec.twoline2rv(rec.line1, rec.line2)
        err, r, v = sat.sgp4(jd, fr)
        if err:
            errors.append({"norad_id": rec.norad_id, "code": int(err), "message": SGP4_ERRORS.get(err, "Unknown SGP4 error")})
            pos_teme.append([math.nan, math.nan, math.nan])
            vel_teme.append([math.nan, math.nan, math.nan])
        else:
            pos_teme.append(r)
            vel_teme.append(v)
    p = np.asarray(pos_teme, dtype=float)
    v = np.asarray(vel_teme, dtype=float)
    ecef = teme_to_ecef(p, dt)
    return {"teme_km": p, "ecef_km": ecef, "velocity_teme_km_s": v, "errors": errors}


def altitude_km(r_km: np.ndarray) -> np.ndarray:
    return np.linalg.norm(r_km, axis=-1) - R_EARTH_KM
