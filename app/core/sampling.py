"""Shared sampled-time metrics. States are held over [t_i, t_(i+1))."""
import math
import numpy as np


def sample_count(duration_min, step_sec):
    end = float(duration_min) * 60.0
    step = float(step_sec)
    if not math.isfinite(end) or not math.isfinite(step) or end <= 0 or step <= 0:
        raise ValueError("Duration and step must be finite and positive.")
    return max(2, int(math.ceil(end / step)) + 1)


def sample_times(duration_min, step_sec):
    sample_count(duration_min, step_sec)
    end = float(duration_min) * 60.0
    times = np.arange(0.0, end, float(step_sec))
    return np.append(times, end)


def sampled_metrics(best_ids, counts, times):
    times = np.asarray(times, dtype=float)
    counts = np.asarray(counts, dtype=int)
    if len(times) != len(counts) or len(best_ids) != len(times):
        raise ValueError("Timeline arrays must have equal lengths.")
    dt = np.diff(times)
    if np.any(dt <= 0):
        raise ValueError("Timeline times must increase strictly.")
    duration = float(dt.sum())
    visible = counts > 0
    handovers = reconnects = 0
    previous = None
    seen_connection = False
    for sid, has_visibility in zip(best_ids, visible):
        if sid is None or not has_visibility:
            previous = None
            continue
        if previous is None:
            if seen_connection:
                reconnects += 1
        elif sid != previous:
            handovers += 1
        previous = sid
        seen_connection = True
    outage = longest = 0.0
    for has_visibility, seconds in zip(visible[:-1], dt):
        outage = 0.0 if has_visibility else outage + float(seconds)
        longest = max(longest, outage)
    return {
        "availability": float(np.dot(visible[:-1], dt) / duration) if duration else float(visible[0]) if len(visible) else 0.0,
        "avg_visible": float(np.dot(counts[:-1], dt) / duration) if duration else float(counts[0]) if len(counts) else 0.0,
        "max_visible": int(counts.max()) if len(counts) else 0,
        "handover_count": handovers,
        "reconnection_count": reconnects,
        "handovers_per_hour": handovers * 3600.0 / duration if duration else 0.0,
        "max_sampled_outage_sec": longest,
        "analysis_duration_sec": duration,
        "max_sample_interval_sec": float(dt.max()) if len(dt) else 0.0,
        "availability_basis": "geometric_visibility",
        "sampling_method": "left_hold_intervals",
    }
