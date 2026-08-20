import heapq
import itertools
import numpy as np
from .constants import C_KM_S
from .models import ConstellationConfig, GroundStation
from .ground import elevation_and_range
from .isl import active_isl_edges
from .constellation import satellite_ids


def _dijkstra(n_nodes, adjacency, sources, targets):
    dist = [float('inf')] * n_nodes
    prev = [None] * n_nodes
    pq = []
    for s, cost in sources:
        if cost < dist[s]:
            dist[s] = cost
            heapq.heappush(pq, (cost, s))
    target_set = set(targets)
    final = None
    while pq:
        d, u = heapq.heappop(pq)
        if d != dist[u]:
            continue
        if u in target_set:
            final = u
            break
        for v, w in adjacency[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if final is None:
        return None, None, None
    path = [final]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    path.reverse()
    return dist[final], path, final


def minimum_station_pair_route(cfg: ConstellationConfig, positions_eci: np.ndarray, positions_ecef: np.ndarray,
                               a: GroundStation, b: GroundStation):
    """Minimum propagation-time path at a snapshot.

    Access links are station<->visible satellite; backbone uses active candidate ISLs.
    Processing/queuing delays are intentionally excluded, so result is a physical lower bound.
    """
    edges = active_isl_edges(cfg, positions_eci)
    n = len(positions_eci)
    adjacency = [[] for _ in range(n)]
    for e in edges:
        w = e['propagation_ms']
        adjacency[e['a']].append((e['b'], w))
        adjacency[e['b']].append((e['a'], w))

    elev_a, rng_a = elevation_and_range(positions_ecef, a)
    elev_b, rng_b = elevation_and_range(positions_ecef, b)
    vis_a = np.where(elev_a >= a.min_elevation_deg)[0]
    vis_b = np.where(elev_b >= b.min_elevation_deg)[0]
    if len(vis_a) == 0 or len(vis_b) == 0:
        return None

    source_costs = [(int(i), 1000.0 * float(rng_a[i]) / C_KM_S) for i in vis_a]
    target_costs = {int(i): 1000.0 * float(rng_b[i]) / C_KM_S for i in vis_b}

    # Add destination access cost when a target node is reached by augmenting with super-target logic.
    # Simpler: run Dijkstra from all source sats once, then evaluate all visible destination sats.
    dist = [float('inf')] * n
    prev = [None] * n
    pq = []
    for s, cost in source_costs:
        dist[s] = min(dist[s], cost)
        heapq.heappush(pq, (dist[s], s))
    while pq:
        d,u = heapq.heappop(pq)
        if d != dist[u]:
            continue
        for v,w in adjacency[u]:
            nd=d+w
            if nd<dist[v]:
                dist[v]=nd; prev[v]=u; heapq.heappush(pq,(nd,v))

    best = min(target_costs, key=lambda i: dist[i] + target_costs[i])
    if not np.isfinite(dist[best]):
        return None
    total = dist[best] + target_costs[best]
    path=[best]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    path.reverse()
    ids=satellite_ids(cfg)
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


def all_station_pair_routes(cfg, positions_eci, positions_ecef, stations):
    out=[]
    for a,b in itertools.combinations(stations,2):
        r=minimum_station_pair_route(cfg,positions_eci,positions_ecef,a,b)
        if r is not None:
            out.append(r)
    return out
