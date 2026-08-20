from typing import Dict, List
import numpy as np
from .models import ConstellationConfig, GroundStation
from .constellation import satellite_positions_eci, satellite_ids
from .orbit import eci_to_ecef
from .ground import elevation_and_range
from .constants import C_KM_S


def _handover_stats(best_indices, visible_counts, times_sec):
    handovers = 0
    prev = None
    for idx in best_indices:
        if idx is None:
            continue
        if prev is not None and idx != prev:
            handovers += 1
        prev = idx
    duration_hr = (float(times_sec[-1] - times_sec[0]) / 3600.0) if len(times_sec) > 1 else 0.0
    handovers_per_hr = handovers / duration_hr if duration_hr > 0 else 0.0

    # Sampled maximum service outage duration. Conservative at the sampling resolution.
    max_run = cur = 0
    for c in visible_counts:
        if c == 0:
            cur += 1
            max_run = max(max_run, cur)
        else:
            cur = 0
    step = float(np.median(np.diff(times_sec))) if len(times_sec) > 1 else 0.0
    max_outage_sec = max_run * step
    return handovers, handovers_per_hr, max_outage_sec


def station_timeline(cfg: ConstellationConfig, station: GroundStation, times_sec: np.ndarray) -> Dict:
    visible_counts = []
    min_ranges = []
    best_elev = []
    best_indices = []
    ids = satellite_ids(cfg)
    for t in times_sec:
        ecef = eci_to_ecef(satellite_positions_eci(cfg, float(t)), float(t))
        elev, rng = elevation_and_range(ecef, station)
        mask = elev >= station.min_elevation_deg
        visible_counts.append(int(mask.sum()))
        best_elev.append(float(elev.max()))
        if mask.any():
            candidates = np.where(mask)[0]
            # Best-serving satellite defined as the highest-elevation visible satellite.
            b = int(candidates[np.argmax(elev[candidates])])
            best_indices.append(b)
            min_ranges.append(float(rng[b]))
        else:
            best_indices.append(None)
            min_ranges.append(None)
    arr = np.asarray(visible_counts, dtype=int)
    availability = float(np.mean(arr > 0)) if len(arr) else 0.0
    avg_visible = float(np.mean(arr)) if len(arr) else 0.0
    min_latency = [None if r is None else 1000.0 * r / C_KM_S for r in min_ranges]
    handovers, hph, max_outage = _handover_stats(best_indices, visible_counts, times_sec)
    return {
        "name": station.name,
        "lat_deg": station.lat_deg,
        "lon_deg": station.lon_deg,
        "min_elevation_deg": station.min_elevation_deg,
        "times_sec": times_sec.tolist(),
        "visible_counts": visible_counts,
        "best_elevation_deg": best_elev,
        "best_satellite_ids": [None if i is None else ids[i] for i in best_indices],
        "best_slant_range_km": min_ranges,
        "min_one_way_propagation_ms": min_latency,
        "availability": availability,
        "avg_visible": avg_visible,
        "max_visible": int(arr.max()) if len(arr) else 0,
        "handover_count": int(handovers),
        "handovers_per_hour": float(hph),
        "max_sampled_outage_sec": float(max_outage),
    }


def multi_station_summary(cfg: ConstellationConfig, stations: List[GroundStation], times_sec: np.ndarray):
    timelines = [station_timeline(cfg, st, times_sec) for st in stations]
    return timelines, {
        "mean_availability": float(np.mean([x["availability"] for x in timelines])) if timelines else 0.0,
        "worst_availability": float(np.min([x["availability"] for x in timelines])) if timelines else 0.0,
        "mean_visible": float(np.mean([x["avg_visible"] for x in timelines])) if timelines else 0.0,
        "mean_handovers_per_hour": float(np.mean([x["handovers_per_hour"] for x in timelines])) if timelines else 0.0,
        "worst_sampled_outage_sec": float(np.max([x["max_sampled_outage_sec"] for x in timelines])) if timelines else 0.0,
    }
