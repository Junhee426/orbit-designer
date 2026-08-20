from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
from typing import Iterable

import numpy as np

from .constellation import satellite_ids, satellite_positions_eci, walker_elements
from .heatmap import instantaneous_coverage_heatmap, instantaneous_coverage_heatmaps
from .models import ConstellationConfig, GroundStation
from .orbit import eci_to_ecef, ecef_to_latlon, orbital_period_s, mean_motion_rad_s, j2_raan_rate_rad_s
from .ground import elevation_and_range
from .visualization import (
    access_links, nearest_neighbor_isl_links, tle_orbit_paths,
    walker_isl_links, walker_orbit_paths,
)
from .tle import TLERecord, altitude_km as tle_altitude_km, parse_tle_text, propagate_tles


def _iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(value: str | None, default: datetime | None = None) -> datetime:
    if not value:
        if default is not None:
            return default.astimezone(timezone.utc)
        return datetime.now(timezone.utc)
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def walker_snapshot(
    cfg: ConstellationConfig,
    t_sec: float,
    min_elevation_deg: float = 20.0,
    heatmap: bool = True,
    heatmap_points: int = 28,
    stations: Iterable[GroundStation] | None = None,
    include_orbits: bool = True,
    include_isl: bool = True,
    include_access: bool = True,
    orbit_samples: int = 96,
    coverage_areas: list[dict] | None = None,
) -> dict:
    pos_eci = satellite_positions_eci(cfg, t_sec)
    pos_ecef = eci_to_ecef(pos_eci, t_sec)
    lat, lon = ecef_to_latlon(pos_ecef)
    ids = satellite_ids(cfg)
    pidx, sidx, raan0, u0 = walker_elements(cfg)
    n = mean_motion_rad_s(cfg.altitude_km)
    raan_rate = j2_raan_rate_rad_s(cfg.altitude_km, cfg.inclination_deg) if cfg.j2 else 0.0
    raan = raan0 + raan_rate * t_sec
    u = u0 + n * t_sec
    circ_speed = math.sqrt(398600.4418 / (6378.137 + cfg.altitude_km))

    satellites = []
    for i, sat_id in enumerate(ids):
        satellites.append({
            "id": sat_id,
            "name": sat_id,
            "source": "Walker",
            "plane": int(pidx[i]) + 1,
            "slot": int(sidx[i]) + 1,
            "x_km": float(pos_eci[i, 0]),
            "y_km": float(pos_eci[i, 1]),
            "z_km": float(pos_eci[i, 2]),
            "ecef_x_km": float(pos_ecef[i, 0]),
            "ecef_y_km": float(pos_ecef[i, 1]),
            "ecef_z_km": float(pos_ecef[i, 2]),
            "lat_deg": float(lat[i]),
            "lon_deg": float(lon[i]),
            "altitude_km": float(cfg.altitude_km),
            "speed_km_s": float(circ_speed),
            "inclination_deg": float(cfg.inclination_deg),
            "raan_deg": float(np.degrees(raan[i]) % 360.0),
            "argument_latitude_deg": float(np.degrees(u[i]) % 360.0),
            "period_min": float(orbital_period_s(cfg.altitude_km) / 60.0),
        })

    heatmaps = instantaneous_coverage_heatmaps(pos_ecef, coverage_areas, min_elevation_deg, heatmap_points) if heatmap else []
    hm = heatmaps[0] if heatmaps else None
    station_list = list(stations or [])
    viz = {
        "orbits": walker_orbit_paths(cfg, t_sec, orbit_samples) if include_orbits else [],
        "isl_links": walker_isl_links(cfg, pos_eci, pos_ecef, ids) if include_isl else [],
        "access_links": access_links(pos_ecef, ids, station_list) if include_access and station_list else [],
    }
    return {
        "mode": "walker",
        "time_sec": float(t_sec),
        "satellites": satellites,
        "heatmap": hm,
        "heatmaps": heatmaps,
        "visualization": viz,
        "errors": [],
    }


def _tle_records_and_start(tle_text: str, start_utc: str | None) -> tuple[list[TLERecord], datetime]:
    records = parse_tle_text(tle_text)
    default_start = max(r.epoch_utc for r in records)
    return records, parse_utc(start_utc, default=default_start)


def tle_snapshot(
    tle_text: str,
    start_utc: str | None,
    t_sec: float,
    min_elevation_deg: float = 20.0,
    heatmap: bool = True,
    heatmap_points: int = 28,
    stations: Iterable[GroundStation] | None = None,
    include_orbits: bool = True,
    include_isl: bool = True,
    include_access: bool = True,
    orbit_samples: int = 96,
    coverage_areas: list[dict] | None = None,
) -> dict:
    records, start = _tle_records_and_start(tle_text, start_utc)
    when = start + timedelta(seconds=float(t_sec))
    propagated = propagate_tles(records, when)
    p = propagated["teme_km"]
    ecef = propagated["ecef_km"]
    vel = propagated["velocity_teme_km_s"]
    lat, lon = ecef_to_latlon(ecef)
    alt = tle_altitude_km(p)
    speed = np.linalg.norm(vel, axis=1)

    def finite(value):
        value = float(value)
        return value if math.isfinite(value) else None

    satellites = []
    for i, rec in enumerate(records):
        satellites.append({
            "id": f"NORAD-{rec.norad_id}",
            "name": rec.name,
            "source": "TLE/SGP4",
            "norad_id": rec.norad_id,
            "epoch_utc": _iso_utc(rec.epoch_utc),
            "propagation_utc": _iso_utc(when),
            "x_km": finite(p[i, 0]),
            "y_km": finite(p[i, 1]),
            "z_km": finite(p[i, 2]),
            "ecef_x_km": finite(ecef[i, 0]),
            "ecef_y_km": finite(ecef[i, 1]),
            "ecef_z_km": finite(ecef[i, 2]),
            "lat_deg": finite(lat[i]),
            "lon_deg": finite(lon[i]),
            "altitude_km": finite(alt[i]),
            "speed_km_s": finite(speed[i]),
            "inclination_deg": rec.inclination_deg,
            "raan_deg": rec.raan_deg,
            "eccentricity": rec.eccentricity,
            "arg_perigee_deg": rec.arg_perigee_deg,
            "mean_anomaly_deg": rec.mean_anomaly_deg,
            "mean_motion_rev_day": rec.mean_motion_rev_day,
            "period_min": rec.orbital_period_min,
        })
    heatmaps = instantaneous_coverage_heatmaps(ecef, coverage_areas, min_elevation_deg, heatmap_points) if heatmap else []
    hm = heatmaps[0] if heatmaps else None
    ids = [f"NORAD-{rec.norad_id}" for rec in records]
    station_list = list(stations or [])
    viz = {
        "orbits": tle_orbit_paths(records, when, orbit_samples) if include_orbits else [],
        "isl_links": nearest_neighbor_isl_links(p, ecef, ids) if include_isl else [],
        "access_links": access_links(ecef, ids, station_list) if include_access and station_list else [],
    }
    return {
        "mode": "tle",
        "time_sec": float(t_sec),
        "start_utc_effective": _iso_utc(start),
        "propagation_utc": _iso_utc(when),
        "satellites": satellites,
        "heatmap": hm,
        "heatmaps": heatmaps,
        "visualization": viz,
        "errors": propagated["errors"],
    }


def tle_station_timelines(
    tle_text: str,
    start_utc: str | None,
    stations: Iterable[GroundStation],
    duration_min: float,
    step_sec: float,
) -> dict:
    records, start = _tle_records_and_start(tle_text, start_utc)
    times = np.arange(0.0, duration_min * 60.0 + 0.1, step_sec)
    ids = [f"NORAD-{r.norad_id}" for r in records]
    by_station = [{
        "station": st,
        "visible_counts": [],
        "best_elevation": [],
        "best_ids": [],
        "ranges": [],
    } for st in stations]
    errors = []

    for t in times:
        when = start + timedelta(seconds=float(t))
        pr = propagate_tles(records, when)
        errors.extend(pr["errors"])
        ecef = pr["ecef_km"]
        for item in by_station:
            st = item["station"]
            elev, rng = elevation_and_range(ecef, st)
            valid = np.isfinite(elev) & np.isfinite(rng)
            mask = valid & (elev >= st.min_elevation_deg)
            item["visible_counts"].append(int(mask.sum()))
            item["best_elevation"].append(float(np.nanmax(elev)) if np.any(valid) else None)
            if np.any(mask):
                candidates = np.where(mask)[0]
                b = int(candidates[np.argmax(elev[candidates])])
                item["best_ids"].append(ids[b])
                item["ranges"].append(float(rng[b]))
            else:
                item["best_ids"].append(None)
                item["ranges"].append(None)

    timelines = []
    for item in by_station:
        counts = np.asarray(item["visible_counts"], dtype=int)
        handovers = 0
        prev = None
        for sat_id in item["best_ids"]:
            if sat_id is None:
                continue
            if prev is not None and sat_id != prev:
                handovers += 1
            prev = sat_id
        duration_hr = (times[-1] - times[0]) / 3600.0 if len(times) > 1 else 0.0
        max_run = cur = 0
        for c in counts:
            if c == 0:
                cur += 1
                max_run = max(max_run, cur)
            else:
                cur = 0
        st = item["station"]
        timelines.append({
            "name": st.name,
            "lat_deg": st.lat_deg,
            "lon_deg": st.lon_deg,
            "min_elevation_deg": st.min_elevation_deg,
            "times_sec": times.tolist(),
            "visible_counts": item["visible_counts"],
            "best_elevation_deg": item["best_elevation"],
            "best_satellite_ids": item["best_ids"],
            "best_slant_range_km": item["ranges"],
            "availability": float(np.mean(counts > 0)) if len(counts) else 0.0,
            "avg_visible": float(np.mean(counts)) if len(counts) else 0.0,
            "max_visible": int(counts.max()) if len(counts) else 0,
            "handover_count": int(handovers),
            "handovers_per_hour": float(handovers / duration_hr) if duration_hr > 0 else 0.0,
            "max_sampled_outage_sec": float(max_run * step_sec),
        })

    summary = {
        "mean_availability": float(np.mean([x["availability"] for x in timelines])) if timelines else 0.0,
        "worst_availability": float(np.min([x["availability"] for x in timelines])) if timelines else 0.0,
        "mean_visible": float(np.mean([x["avg_visible"] for x in timelines])) if timelines else 0.0,
        "mean_handovers_per_hour": float(np.mean([x["handovers_per_hour"] for x in timelines])) if timelines else 0.0,
        "worst_sampled_outage_sec": float(np.max([x["max_sampled_outage_sec"] for x in timelines])) if timelines else 0.0,
    }
    snapshot = tle_snapshot(tle_text, _iso_utc(start), 0.0, min_elevation_deg=20.0, heatmap=False)
    return {
        "mode": "tle",
        "start_utc_effective": _iso_utc(start),
        "total_satellites": len(records),
        "coverage_summary": summary,
        "station_timelines": timelines,
        "snapshot": snapshot["satellites"],
        "errors": errors,
    }
