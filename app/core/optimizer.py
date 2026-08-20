from itertools import product
import numpy as np
from .models import ConstellationConfig, GroundStation
from .coverage import multi_station_summary
from .orbit import orbital_period_s


def trade_study(altitudes_km, inclinations_deg, planes_list, sats_per_plane_list,
                stations, phasing=1, duration_min=120.0, step_sec=120.0,
                min_availability=0.95, max_results=30):
    times = np.arange(0.0, duration_min * 60.0 + 0.1, step_sec)
    rows = []
    for h, inc, p, s in product(altitudes_km, inclinations_deg, planes_list, sats_per_plane_list):
        cfg = ConstellationConfig(float(h), float(inc), int(p), int(s), int(phasing), True)
        _, sm = multi_station_summary(cfg, stations, times)
        # Availability dominates; satellite count penalized; visible redundancy gives small reward.
        score = 100.0 * sm["worst_availability"] + 8.0 * sm["mean_visible"] - 0.035 * cfg.total_satellites
        rows.append({
            "altitude_km": float(h), "inclination_deg": float(inc), "planes": int(p),
            "sats_per_plane": int(s), "total_satellites": cfg.total_satellites,
            "mean_availability": sm["mean_availability"], "worst_availability": sm["worst_availability"],
            "mean_visible": sm["mean_visible"], "orbital_period_min": orbital_period_s(float(h))/60.0,
            "meets_availability": sm["worst_availability"] >= min_availability,
            "score": score,
        })
    rows.sort(key=lambda x: (not x["meets_availability"], -x["score"], x["total_satellites"]))
    return rows[:max_results]
