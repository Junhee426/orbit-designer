from typing import Dict, List
import numpy as np
from .models import ConstellationConfig, GroundStation
from .constellation import satellite_states_ecef, satellite_ids
from .ground import elevation_and_range, elevation_and_range_grid, stations_ecef
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
    """Vectorised equivalent of timelines_from_states() for a single Walker constellation.

    Propagates satellites and broadcasts all stations against them a time
    chunk at a time, instead of a Python loop per (time, station) pair.
    Chunk size is sized so the (chunk, S, N) working arrays stay a few MB
    regardless of constellation/station size. Field-for-field identical to
    the generic path.
    """
    ids = satellite_ids(cfg)
    times = np.asarray(times_sec, dtype=float)
    st_ecef = stations_ecef(stations)
    thresholds = np.array([max(0.0, st.min_elevation_deg) for st in stations])

    n_sats, n_stations = cfg.total_satellites, max(1, len(stations))
    chunk = max(1, min(len(times), 2_000_000 // (n_stations * n_sats)))

    T, S = len(times), len(stations)
    visible_counts = np.empty((T, S), dtype=np.int64)
    has_vis = np.empty((T, S), dtype=bool)
    best_idx = np.empty((T, S), dtype=np.int64)
    best_rng = np.empty((T, S), dtype=float)
    best_elev_overall = np.empty((T, S), dtype=float)

    for i in range(0, T, chunk):
        sat_ecef = satellite_states_ecef(cfg, times[i:i + chunk], chunk=chunk)  # (c, N, 3)
        elev, rng = elevation_and_range_grid(sat_ecef, st_ecef)                 # (c, S, N)
        valid = np.isfinite(elev) & np.isfinite(rng)
        mask = valid & (elev >= thresholds[None, :, None])
        visible_counts[i:i + chunk] = mask.sum(axis=-1)
        has_vis[i:i + chunk] = mask.any(axis=-1)
        idx = np.where(mask, elev, -np.inf).argmax(axis=-1)
        best_idx[i:i + chunk] = idx
        best_rng[i:i + chunk] = np.take_along_axis(rng, idx[..., None], axis=-1)[..., 0]
        valid_any = valid.any(axis=-1)
        best_elev_overall[i:i + chunk] = np.where(valid_any, np.where(valid, elev, -np.inf).max(axis=-1), np.nan)

    rows = []
    times_list = times.tolist()
    for s_i, st in enumerate(stations):
        row_has_vis = has_vis[:, s_i]
        row_best_idx = best_idx[:, s_i]
        row_best_rng = best_rng[:, s_i]
        row = dict(
            name=st.name, lat_deg=st.lat_deg, lon_deg=st.lon_deg,
            min_elevation_deg=max(0.0, st.min_elevation_deg), times_sec=times_list,
            visible_counts=visible_counts[:, s_i].tolist(),
            best_elevation_deg=[float(v) if np.isfinite(v) else None for v in best_elev_overall[:, s_i]],
            best_satellite_ids=[ids[i] if ok else None for ok, i in zip(row_has_vis, row_best_idx)],
            best_slant_range_km=[float(d) if ok else None for ok, d in zip(row_has_vis, row_best_rng)],
            min_one_way_propagation_ms=[1000.0 * float(d) / C_KM_S if ok else None for ok, d in zip(row_has_vis, row_best_rng)],
        )
        row.update(sampled_metrics(row["best_satellite_ids"], row["visible_counts"], times))
        rows.append(row)
    return rows, summarize_timelines(rows)
