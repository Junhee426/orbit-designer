from __future__ import annotations

import math
import numpy as np

from .constants import C_KM_S, MU_EARTH_KM3_S2, R_EARTH_KM
from .constellation import satellite_positions_eci, satellite_ids
from .coverage import timelines_from_states, summarize_timelines
from .sampling import sample_times
from .geometry import walker_orbital_geometry
from .ground import elevation_and_range
from .heatmap import instantaneous_coverage_heatmaps
from .models import ConstellationConfig, GroundStation
from .orbit import eci_to_ecef, ecef_to_latlon, orbital_period_s, mean_motion_rad_s, j2_raan_rate_rad_s
from .visualization import access_links, walker_isl_links, walker_orbit_paths


def normalize_shell_id(value: str, index: int) -> str:
    raw = ''.join(ch for ch in str(value or '') if ch.isalnum() or ch in ('-', '_')).strip('-_')
    return raw or f"SH{index+1}"


def combined_state(shells: list[tuple[str, str, ConstellationConfig]], t_sec: float):
    ids, meta, eci_parts, ecef_parts = [], [], [], []
    for i, (shell_id, shell_name, cfg) in enumerate(shells):
        sid = normalize_shell_id(shell_id, i)
        eci = satellite_positions_eci(cfg, t_sec)
        ecef = eci_to_ecef(eci, t_sec)
        local_ids = satellite_ids(cfg)
        ids.extend([f"{sid}-{x}" for x in local_ids])
        meta.extend([(sid, shell_name, cfg, x) for x in local_ids])
        eci_parts.append(eci); ecef_parts.append(ecef)
    if not eci_parts:
        return [], [], np.empty((0,3)), np.empty((0,3))
    return ids, meta, np.concatenate(eci_parts), np.concatenate(ecef_parts)


def multi_shell_snapshot(shells: list[tuple[str, str, ConstellationConfig]], t_sec: float, min_elevation_deg: float = 20.0, heatmap: bool = True, heatmap_points: int = 28, stations=None, include_orbits: bool = True, include_isl: bool = True, include_access: bool = True, orbit_samples: int = 96, coverage_areas=None) -> dict:
    ids, meta, pos_eci, pos_ecef = combined_state(shells, t_sec)
    lat, lon = ecef_to_latlon(pos_ecef)
    satellites=[]; offset=0; orbit_paths=[]; isl_links=[]
    for shell_idx,(shell_id,shell_name,cfg) in enumerate(shells):
        sid=normalize_shell_id(shell_id,shell_idx)
        count=cfg.total_satellites
        pcount=cfg.planes; spp=cfg.sats_per_plane
        n=mean_motion_rad_s(cfg.altitude_km); rr=j2_raan_rate_rad_s(cfg.altitude_km,cfg.inclination_deg) if cfg.j2 else 0.0
        local_ids=satellite_ids(cfg)
        # derive display plane/slot from deterministic ordering
        for j in range(count):
            plane=j//spp+1; slot=j%spp+1
            # derive RAAN and u consistently with Walker convention
            raan0=2*math.pi*(plane-1)/pcount
            u0=2*math.pi*(slot-1)/spp+2*math.pi*cfg.phasing*(plane-1)/count
            satellites.append({
                "id":f"{sid}-{local_ids[j]}","name":f"{sid} · {local_ids[j]}","source":"Multi-shell Walker",
                "shell_id":sid,"shell_name":shell_name,"shell_index":shell_idx+1,"plane":plane,"slot":slot,
                "x_km":float(pos_eci[offset+j,0]),"y_km":float(pos_eci[offset+j,1]),"z_km":float(pos_eci[offset+j,2]),
                "ecef_x_km":float(pos_ecef[offset+j,0]),"ecef_y_km":float(pos_ecef[offset+j,1]),"ecef_z_km":float(pos_ecef[offset+j,2]),
                "lat_deg":float(lat[offset+j]),"lon_deg":float(lon[offset+j]),"altitude_km":float(cfg.altitude_km),
                "speed_km_s":float(math.sqrt(MU_EARTH_KM3_S2/(R_EARTH_KM+cfg.altitude_km))),"inclination_deg":float(cfg.inclination_deg),
                "raan_deg":float(math.degrees(raan0+rr*t_sec)%360),"argument_latitude_deg":float(math.degrees(u0+n*t_sec)%360),
                "period_min":float(orbital_period_s(cfg.altitude_km)/60.0),
            })
        if include_orbits:
            for p in walker_orbit_paths(cfg,t_sec,orbit_samples):
                p={**p,"id":f"{sid}-{p['id']}","shell_id":sid,"shell_name":shell_name}; orbit_paths.append(p)
        if include_isl:
            local_eci=pos_eci[offset:offset+count]; local_ecef=pos_ecef[offset:offset+count]
            prefixed=[f"{sid}-{x}" for x in local_ids]
            for link in walker_isl_links(cfg,local_eci,local_ecef,prefixed):
                link["shell_id"]=sid; isl_links.append(link)
        offset+=count
    heatmaps=instantaneous_coverage_heatmaps(pos_ecef,coverage_areas,min_elevation_deg,heatmap_points) if heatmap and len(pos_ecef) else []
    st=list(stations or [])
    return {"mode":"multi_shell","time_sec":float(t_sec),"satellites":satellites,"heatmap":heatmaps[0] if heatmaps else None,"heatmaps":heatmaps,
            "shells":[{"id":normalize_shell_id(x[0],i),"name":x[1],**x[2].to_dict()} for i,x in enumerate(shells)],
            "visualization":{"orbits":orbit_paths,"isl_links":isl_links,"access_links":access_links(pos_ecef,ids,st) if include_access and st else []},"errors":[]}


def multi_shell_station_timeline(shells, station: GroundStation, times_sec: np.ndarray):
    ids = combined_state(shells, 0.0)[0]
    return timelines_from_states([station], times_sec, ids, lambda t: combined_state(shells, t)[3])[0]


def run_multi_shell_simulation(shells, stations, duration_min: float, step_sec: float):
    times = sample_times(duration_min, step_sec)
    ids = combined_state(shells, 0.0)[0]
    timelines = timelines_from_states(stations, times, ids, lambda t: combined_state(shells, t)[3])
    return {"mode":"multi_shell", "total_satellites":sum(x[2].total_satellites for x in shells),
            "orbital_period_min":None,
            "shells":[{"id":normalize_shell_id(x[0],i), "name":x[1], **x[2].to_dict(),
                       "period_min":orbital_period_s(x[2].altitude_km)/60.0} for i,x in enumerate(shells)],
            "coverage_summary":summarize_timelines(timelines), "station_timelines":timelines, "snapshot":[]}


def multi_shell_orbital_geometry(shells, satellite_id: str, t_sec: float, **kwargs):
    for i,(shell_id,shell_name,cfg) in enumerate(shells):
        sid=normalize_shell_id(shell_id,i); prefix=f"{sid}-"
        if satellite_id.startswith(prefix) and satellite_id[len(prefix):] in satellite_ids(cfg):
            local=satellite_id[len(prefix):]
            g=walker_orbital_geometry(cfg,local,t_sec,**kwargs)
            g["satellite_id"]=satellite_id; g["shell_id"]=sid; g["shell_name"]=shell_name
            g["ground_track"]["satellite_id"]=satellite_id; g["footprint"]["satellite_id"]=satellite_id
            return g
    raise ValueError(f"Unknown multi-shell satellite id: {satellite_id}")
