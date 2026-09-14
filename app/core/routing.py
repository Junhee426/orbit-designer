import heapq
import numpy as np
from .constants import C_KM_S
from .models import ConstellationConfig, GroundStation
from .ground import elevation_and_range
from .isl import active_isl_edges
from .constellation import satellite_ids


def _satellite_adjacency(cfg, positions_eci):
    edges = active_isl_edges(cfg, positions_eci)
    adjacency = [[] for _ in range(len(positions_eci))]
    for e in edges:
        w = e['propagation_ms']
        adjacency[e['a']].append((e['b'], w))
        adjacency[e['b']].append((e['a'], w))
    return adjacency


def _station_access_costs(positions_ecef, station):
    elevations, ranges = elevation_and_range(positions_ecef, station)
    visible = np.where(elevations >= max(0.0, station.min_elevation_deg))[0]
    return {int(i): 1000.0 * float(ranges[i]) / C_KM_S for i in visible}


def _shortest_paths(adjacency, source_costs):
    """Distances from one station's access satellites to the entire backbone."""
    n = len(adjacency)
    dist = [float('inf')] * n
    prev = [None] * n
    pq = []
    for s, cost in source_costs.items():
        dist[s] = min(dist[s], cost)
        heapq.heappush(pq, (dist[s], s))
    while pq:
        d, u = heapq.heappop(pq)
        if d != dist[u]:
            continue
        for v, w in adjacency[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return dist, prev


def _station_pair_result(a, b, ids, dist, prev, target_costs):
    if not target_costs:
        return None
    best = min(target_costs, key=lambda i: dist[i] + target_costs[i])
    if not np.isfinite(dist[best]):
        return None
    total = dist[best] + target_costs[best]
    path = [best]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    path.reverse()
    return {
        'from': a.name,
        'to': b.name,
        'one_way_propagation_ms': float(total),
        'satellite_hops': max(0, len(path)-1),
        'path_satellites': [ids[i] for i in path],
        'source_access_satellite': ids[path[0]],
        'destination_access_satellite': ids[path[-1]],
        'note': 'Propagation only; excludes RF/optical processing, switching, queuing and terrestrial backhaul.'
    }


def minimum_station_pair_route(cfg: ConstellationConfig, positions_eci: np.ndarray, positions_ecef: np.ndarray,
                               a: GroundStation, b: GroundStation):
    """Minimum propagation-time path at a snapshot.

    Access links are station<->visible satellite; backbone uses active candidate ISLs.
    Processing/queuing delays are intentionally excluded, so result is a physical lower bound.
    """
    adjacency = _satellite_adjacency(cfg, positions_eci)
    source_costs = _station_access_costs(positions_ecef, a)
    target_costs = _station_access_costs(positions_ecef, b)
    if not source_costs or not target_costs:
        return None
    dist, prev = _shortest_paths(adjacency, source_costs)
    return _station_pair_result(a, b, satellite_ids(cfg), dist, prev, target_costs)


def all_station_pair_routes(cfg, positions_eci, positions_ecef, stations):
    stations = list(stations)
    if len(stations) < 2:
        return []
    adjacency = _satellite_adjacency(cfg, positions_eci)
    ids = satellite_ids(cfg)
    access_costs = [_station_access_costs(positions_ecef, station) for station in stations]
    out = []
    for i, a in enumerate(stations[:-1]):
        if not access_costs[i]:
            continue
        dist, prev = _shortest_paths(adjacency, access_costs[i])
        for j in range(i + 1, len(stations)):
            r = _station_pair_result(a, stations[j], ids, dist, prev, access_costs[j])
            if r is not None:
                out.append(r)
    return out
