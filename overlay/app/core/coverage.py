from typing import Dict, List
import numpy as np
from .models import ConstellationConfig, GroundStation
from .constellation import satellite_positions_eci, satellite_ids
from .orbit import eci_to_ecef
from .ground import elevation_and_range
from .constants import C_KM_S
from .sampling import sampled_metrics


def _handover_stats(best_indices, visible_counts, times_sec):
    m = sampled_metrics(best_indices, visible_counts, times_sec)
    return m["handover_count"], m["handovers_per_hour"], m["max_sampled_outage_sec"]


def timelines_from_states(stations, times_sec, ids, state_at_time):
    """Propagate once per time step and release positions after all stations."""
    rows = [dict(name=st.name, lat_deg=st.lat_deg, lon_deg=st.lon_deg,
                 min_elevation_deg=max(0.0, st.min_elevation_deg), times_sec=times_sec.tolist(),
                 visible_counts=[], best_elevation_deg=[], best_satellite_ids=[],
                 best_slant_range_km=[], min_one_way_propagation_ms=[]) for st in stations]
    for t in times_sec:
        ecef = state_at_time(float(t))
        for st, row in zip(stations, rows):
            elev, rng = elevation_and_range(ecef, st)
            valid = np.isfinite(elev) & np.isfinite(rng)
            mask = valid & (elev >= max(0.0, st.min_elevation_deg))
            row["visible_counts"].append(int(mask.sum()))
            row["best_elevation_deg"].append(float(elev[valid].max()) if valid.any() else None)
            best = int(np.where(mask)[0][np.argmax(elev[mask])]) if mask.any() else None
            distance = float(rng[best]) if best is not None else None
            row["best_satellite_ids"].append(ids[best] if best is not None else None)
            row["best_slant_range_km"].append(distance)
            row["min_one_way_propagation_ms"].append(1000.0 * distance / C_KM_S if distance is not None else None)
    for row in rows:
        row.update(sampled_metrics(row["best_satellite_ids"], row["visible_counts"], times_sec))
    return rows


def summarize_timelines(timelines):
    def agg(key, op):
        return float(op([row[key] for row in timelines])) if timelines else 0.0
    return {
        "mean_availability": agg("availability", np.mean),
        "worst_availability": agg("availability", np.min),
        "mean_visible": agg("avg_visible", np.mean),
        "mean_handovers_per_hour": agg("handovers_per_hour", np.mean),
        "worst_sampled_outage_sec": agg("max_sampled_outage_sec", np.max),
        "availability_basis": "geometric_visibility",
        "sampling_method": "left_hold_intervals",
    }


def station_timeline(cfg: ConstellationConfig, station: GroundStation, times_sec: np.ndarray) -> Dict:
    return multi_station_summary(cfg, [station], times_sec)[0][0]


def multi_station_summary(cfg: ConstellationConfig, stations: List[GroundStation], times_sec: np.ndarray):
    timelines = timelines_from_states(stations, times_sec, satellite_ids(cfg),
        lambda t: eci_to_ecef(satellite_positions_eci(cfg, t), t))
    return timelines, summarize_timelines(timelines)
