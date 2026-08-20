import numpy as np
from .constants import R_EARTH_KM, C_KM_S
from .models import ConstellationConfig
from .constellation import walker_elements


def segment_clears_earth(a: np.ndarray, b: np.ndarray, earth_radius_km: float = R_EARTH_KM) -> bool:
    d = b - a
    denom = float(np.dot(d, d))
    if denom == 0.0:
        return False
    t = -float(np.dot(a, d)) / denom
    t = min(1.0, max(0.0, t))
    closest = a + t * d
    return float(np.linalg.norm(closest)) > earth_radius_km


def candidate_neighbor_edges(cfg: ConstellationConfig):
    """Generate deterministic along-track and adjacent-plane candidate ISLs."""
    idx = lambda p, s: p * cfg.sats_per_plane + s
    edges = set()
    for p in range(cfg.planes):
        for s in range(cfg.sats_per_plane):
            # Along-track next neighbor (ring closes)
            a, b = idx(p, s), idx(p, (s + 1) % cfg.sats_per_plane)
            edges.add(tuple(sorted((a, b))))
            # Adjacent plane, same slot
            c = idx((p + 1) % cfg.planes, s)
            edges.add(tuple(sorted((a, c))))
    return sorted(edges)


def active_isl_edges(cfg: ConstellationConfig, positions_eci: np.ndarray):
    result = []
    for a, b in candidate_neighbor_edges(cfg):
        pa, pb = positions_eci[a], positions_eci[b]
        if segment_clears_earth(pa, pb):
            dist = float(np.linalg.norm(pa - pb))
            result.append({
                "a": int(a), "b": int(b),
                "range_km": dist,
                "propagation_ms": 1000.0 * dist / C_KM_S,
            })
    return result
