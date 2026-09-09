import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.constants import R_EARTH_KM
from app.core.constellation import satellite_positions_eci
from app.core.models import ConstellationConfig, GroundStation, SimulationConfig
from app.core.orbit import j2_raan_rate_rad_s, orbital_period_s
from app.core.simulation import run_simulation
from app.core.snapshot import walker_snapshot
from app.core.tle import parse_tle_text, propagate_tles, sgp4_available
from app.core.service_regions import resolve_selection
from app.core.geometry import walker_orbital_geometry
from app.core.multishell import multi_shell_snapshot, run_multi_shell_simulation


VANGUARD_TLE = (
    "VANGUARD 1\n"
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n"
    "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
)
VANGUARD_EPOCH_POSITION_KM = np.array([7022.46529266, -1400.08296755, 0.03995155])


def main() -> None:
    cfg = ConstellationConfig(1280, 42, 8, 16, 1, True)
    stations = [
        GroundStation("Seoul", 37.5665, 126.9780, 20),
        GroundStation("Dubai", 25.2048, 55.2708, 20),
        GroundStation("Singapore", 1.3521, 103.8198, 20),
    ]
    res = run_simulation(SimulationConfig(cfg, stations, 120, 60))
    pos = satellite_positions_eci(cfg, 3600)
    rad = np.linalg.norm(pos, axis=1)
    service = resolve_selection(["KOR", "ARE", "SGP"], cities_per_country=1)
    service_stations = [GroundStation(x["name"], x["lat_deg"], x["lon_deg"], 20) for x in service["stations"]]
    snap = walker_snapshot(
        cfg, 0, min_elevation_deg=20, heatmap_points=28, stations=service_stations,
        coverage_areas=service["coverage_areas"],
    )
    geometry = walker_orbital_geometry(cfg, "P01-S01", 0, min_elevation_deg=20, ground_track_samples=181)
    shells = [
        ("SH1", "Core 1280 km", cfg),
        ("SH2", "High-inclination supplement", ConstellationConfig(600, 70, 6, 12, 1, True)),
    ]
    multi_snap = multi_shell_snapshot(shells, 0, min_elevation_deg=20, heatmap=False, stations=service_stations)
    multi_sim = run_multi_shell_simulation(shells, service_stations, 30, 120)

    tle_records = parse_tle_text(VANGUARD_TLE)
    sgp4_check = {
        "available": sgp4_available(),
        "case": "Vanguard 1 / Vallado SGP4 verification case 00005",
        "position_error_m": None,
        "pass_1m": None,
    }
    if sgp4_available():
        propagated = propagate_tles(tle_records, tle_records[0].epoch_utc)
        err_m = float(np.linalg.norm(propagated["teme_km"][0] - VANGUARD_EPOCH_POSITION_KM) * 1000.0)
        sgp4_check["position_error_m"] = err_m
        sgp4_check["pass_1m"] = bool(err_m < 1.0)

    validation = {
        "version": "1.2.0",
        "scenario": "Test Orbit Designer default 1280 km / 42 deg / Walker 8x16 / F=1",
        "orbital_period_min": orbital_period_s(1280) / 60,
        "j2_raan_drift_deg_per_day": float(np.degrees(j2_raan_rate_rad_s(1280, 42)) * 86400),
        "satellite_count": cfg.total_satellites,
        "radius_error_max_m": float(np.max(np.abs(rad - (R_EARTH_KM + 1280))) * 1000),
        "coverage_summary": res["coverage_summary"],
        "stations": [
            {k: v for k, v in t.items() if k in ["name", "availability", "avg_visible", "max_visible"]}
            for t in res["station_timelines"]
        ],
        "service_regions": {
            "country_codes": service["country_codes"],
            "service_points": len(service["stations"]),
            "coverage_tiles": len(service["coverage_areas"]),
            "camera_bounds": service["camera_bounds"],
        },
        "heatmaps_t0": [
            {
                "area_code": hm["area_code"],
                "grid": "28x28",
                "max_visible": hm["max_visible"],
                "mean_visible": hm["mean_visible"],
            } for hm in snap["heatmaps"]
        ],
        "isl_active_edges_t0": res["isl"]["active_edges"],
        "isl_mean_range_km_t0": res["isl"]["mean_range_km"],
        "link_examples": res["link_examples"],
        "tle_parser": {
            "records": len(tle_records),
            "norad_id": tle_records[0].norad_id,
            "epoch_utc": tle_records[0].epoch_utc.isoformat().replace("+00:00", "Z"),
        },
        "sgp4_reference": sgp4_check,
        "v1_1_orbital_geometry": {
            "selected_satellite": geometry["satellite_id"],
            "footprint_radius_km_min_el_20": geometry["footprint"]["surface_radius_km"],
            "footprint_central_angle_deg": geometry["footprint"]["central_angle_deg"],
            "ground_track_segments": len(geometry["ground_track"]["segments_lon_lat_deg"]),
            "ground_track_samples": geometry["ground_track"]["samples"],
        },
        "v1_1_multi_shell": {
            "shell_count": len(shells),
            "satellite_count": len(multi_snap["satellites"]),
            "orbit_paths": len(multi_snap["visualization"]["orbits"]),
            "combined_mean_visible_30min": multi_sim["coverage_summary"]["mean_visible"],
            "isl_scope": "intra-shell only",
        },
    }
    validation["cesium_visualization"] = {
        "orbit_paths": len(snap["visualization"]["orbits"]),
        "isl_links": len(snap["visualization"]["isl_links"]),
        "access_links": len(snap["visualization"]["access_links"]),
        "coverage_tiles": len(snap["heatmaps"]),
        "offline_earth_asset": (ROOT / "app" / "static" / "earth_blue_marble_2048.jpg").exists(),
        "satellite_glb_asset": (ROOT / "app" / "static" / "kleo_satellite.glb").exists(),
    }
    out = Path.cwd() / "outputs" / "validation_report_v1_2_0.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(validation, indent=2), encoding="utf-8")
    print(json.dumps(validation, indent=2))
    if sgp4_check["pass_1m"] is False:
        raise SystemExit("SGP4 reference validation failed.")


if __name__ == "__main__":
    main()
