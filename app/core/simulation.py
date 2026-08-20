import numpy as np
from .models import SimulationConfig
from .coverage import multi_station_summary
from .constellation import satellite_positions_eci, satellite_ids
from .orbit import eci_to_ecef, ecef_to_latlon, orbital_period_s
from .isl import active_isl_edges
from .ground import elevation_and_range
from .link_budget import downlink_margin_db
from .routing import all_station_pair_routes


def run_simulation(cfg: SimulationConfig):
    times = np.arange(0.0, cfg.duration_min * 60.0 + 0.1, cfg.step_sec)
    timelines, coverage_summary = multi_station_summary(cfg.constellation, cfg.stations, times)

    pos_eci = satellite_positions_eci(cfg.constellation, 0.0)
    pos_ecef = eci_to_ecef(pos_eci, 0.0)
    lat, lon = ecef_to_latlon(pos_ecef)
    ids = satellite_ids(cfg.constellation)
    snapshot = [
        {
            "id": ids[i], "x_km": float(p[0]), "y_km": float(p[1]), "z_km": float(p[2]),
            "lat_deg": float(lat[i]), "lon_deg": float(lon[i]),
        }
        for i, p in enumerate(pos_eci)
    ]

    edges = active_isl_edges(cfg.constellation, pos_eci)
    link_examples = []
    for st in cfg.stations:
        elev, rng = elevation_and_range(pos_ecef, st)
        visible = np.where(elev >= st.min_elevation_deg)[0]
        if len(visible):
            best = int(visible[np.argmax(elev[visible])])
            lb = downlink_margin_db(float(rng[best]), cfg.link)
            link_examples.append({
                "station": st.name,
                "satellite": ids[best],
                "range_km": float(rng[best]),
                "elevation_deg": float(elev[best]),
                **lb,
            })

    routes = all_station_pair_routes(cfg.constellation, pos_eci, pos_ecef, cfg.stations)
    return {
        "configuration": cfg.constellation.to_dict(),
        "orbital_period_min": orbital_period_s(cfg.constellation.altitude_km) / 60.0,
        "total_satellites": cfg.constellation.total_satellites,
        "coverage_summary": coverage_summary,
        "station_timelines": timelines,
        "snapshot": snapshot,
        "isl": {
            "active_edges": len(edges),
            "mean_range_km": float(np.mean([e["range_km"] for e in edges])) if edges else None,
            "mean_propagation_ms": float(np.mean([e["propagation_ms"] for e in edges])) if edges else None,
            "edges": edges[:1000],
        },
        "link_examples": link_examples,
        "station_pair_routes": routes,
    }
