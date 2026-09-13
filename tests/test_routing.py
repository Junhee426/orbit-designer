import itertools
from unittest.mock import patch

import numpy as np
import pytest

from app.core import routing
from app.core.constants import C_KM_S
from app.core.models import ConstellationConfig, GroundStation
from app.core.constellation import satellite_ids, satellite_positions_eci
from app.core.ground import elevation_and_range
from app.core.isl import active_isl_edges
from app.core.orbit import eci_to_ecef
from app.core.routing import all_station_pair_routes, minimum_station_pair_route


def test_station_pair_route_is_positive_when_network_connected():
    cfg=ConstellationConfig(888,42,16,16,1,False)
    eci=satellite_positions_eci(cfg,0)
    ecef=eci_to_ecef(eci,0)
    a=GroundStation('Seoul',37.5665,126.978,20)
    b=GroundStation('Dubai',25.2048,55.2708,20)
    route=minimum_station_pair_route(cfg,eci,ecef,a,b)
    assert route is not None
    assert route['one_way_propagation_ms'] > 0
    assert len(route['path_satellites']) >= 1


@pytest.fixture
def small_network(monkeypatch):
    cfg = ConstellationConfig(888, 42, 1, 5, 0, False)
    positions = np.zeros((5, 3))
    edges = [
        {'a': a, 'b': b, 'propagation_ms': cost}
        for a, b, cost in [(0, 1, 2), (1, 2, 3), (0, 2, 9), (2, 3, 1)]
    ]
    access = {'A': {0: 2, 1: 20}, 'B': {2: 4}, 'C': {3: 2}, 'isolated': {4: 1}, 'hidden': {}}

    def station_access(positions_ecef, station):
        elevations = np.full(5, -20.0)
        ranges = np.ones(5)
        for index, cost_ms in access[station.name].items():
            elevations[index] = 20.0
            ranges[index] = cost_ms * C_KM_S / 1000.0
        return elevations, ranges

    monkeypatch.setattr(routing, 'active_isl_edges', lambda cfg, positions: edges)
    monkeypatch.setattr(routing, 'elevation_and_range', station_access)
    stations = {name: GroundStation(name, 0, 0, 20) for name in access}
    return cfg, positions, stations


def test_all_pairs_reuses_snapshot_and_source_searches(small_network):
    cfg, positions, stations = small_network
    selected = [stations[name] for name in ['A', 'B', 'C']]
    with (
        patch.object(routing, 'active_isl_edges', wraps=routing.active_isl_edges) as edges,
        patch.object(routing, 'satellite_ids', wraps=routing.satellite_ids) as ids,
        patch.object(routing, 'elevation_and_range', wraps=routing.elevation_and_range) as access,
        patch.object(routing, '_shortest_paths', wraps=routing._shortest_paths) as searches,
    ):
        routes = all_station_pair_routes(cfg, positions, positions, iter(selected))

    assert edges.call_count == 1
    assert ids.call_count == 1
    assert access.call_count == 3
    assert searches.call_count == 2
    expected = [
        ('A', 'B', 11, ['P01-S01', 'P01-S02', 'P01-S03']),
        ('A', 'C', 10, ['P01-S01', 'P01-S02', 'P01-S03', 'P01-S04']),
        ('B', 'C', 7, ['P01-S03', 'P01-S04']),
    ]
    assert len(routes) == len(expected)
    for route, (source, target, cost, path) in zip(routes, expected):
        assert route['from'] == source
        assert route['to'] == target
        assert route['one_way_propagation_ms'] == pytest.approx(cost)
        assert route['path_satellites'] == path
        assert route['satellite_hops'] == len(path) - 1
        assert route['source_access_satellite'] == path[0]
        assert route['destination_access_satellite'] == path[-1]
        assert route == minimum_station_pair_route(cfg, positions, positions, stations[source], stations[target])


@pytest.mark.parametrize('source,target', [('A', 'isolated'), ('A', 'hidden'), ('hidden', 'A')])
def test_single_pair_returns_none_without_access_or_backbone_path(small_network, source, target):
    cfg, positions, stations = small_network
    assert minimum_station_pair_route(cfg, positions, positions, stations[source], stations[target]) is None


def test_all_pairs_skips_unreachable_stations_without_losing_other_routes(small_network):
    cfg, positions, stations = small_network
    selected = [stations[name] for name in ['A', 'hidden', 'isolated', 'B', 'C']]
    routes = all_station_pair_routes(cfg, positions, positions, selected)
    assert [(route['from'], route['to']) for route in routes] == [('A', 'B'), ('A', 'C'), ('B', 'C')]


def test_shared_access_satellite_needs_no_backbone_hop(small_network):
    cfg, positions, stations = small_network
    route = minimum_station_pair_route(cfg, positions, positions, stations['B'], stations['B'])
    assert route['one_way_propagation_ms'] == pytest.approx(8)
    assert route['satellite_hops'] == 0
    assert route['path_satellites'] == ['P01-S03']


def test_real_snapshot_routes_match_independent_floyd_warshall_costs():
    cfg = ConstellationConfig(1280, 42, 8, 16, 1, True)
    eci = satellite_positions_eci(cfg, 1800)
    ecef = eci_to_ecef(eci, 1800)
    stations = [
        GroundStation('Seoul', 37.5665, 126.978, 20),
        GroundStation('Dubai', 25.2048, 55.2708, 20),
        GroundStation('Singapore', 1.3521, 103.8198, 20),
        GroundStation('London', 51.5074, -0.1278, 20),
    ]
    n = cfg.total_satellites
    direct = np.full((n, n), np.inf)
    np.fill_diagonal(direct, 0)
    for edge in active_isl_edges(cfg, eci):
        direct[edge['a'], edge['b']] = direct[edge['b'], edge['a']] = edge['propagation_ms']
    shortest = direct.copy()
    for k in range(n):
        shortest = np.minimum(shortest, shortest[:, k, None] + shortest[None, k, :])
    access = {}
    for station in stations:
        elevation, ranges = elevation_and_range(ecef, station)
        access[station.name] = np.where(elevation >= station.min_elevation_deg, ranges * 1000 / C_KM_S, np.inf)

    routes = all_station_pair_routes(cfg, eci, ecef, stations)
    by_pair = {(route['from'], route['to']): route for route in routes}
    id_indices = {name: i for i, name in enumerate(satellite_ids(cfg))}
    reachable_pairs = 0
    for source, target in itertools.combinations(stations, 2):
        costs = access[source.name][:, None] + shortest + access[target.name][None, :]
        expected = float(np.min(costs))
        pair = (source.name, target.name)
        if not np.isfinite(expected):
            assert pair not in by_pair
            continue
        reachable_pairs += 1
        route = by_pair[pair]
        assert route['one_way_propagation_ms'] == pytest.approx(expected)
        path = [id_indices[name] for name in route['path_satellites']]
        actual = access[source.name][path[0]] + access[target.name][path[-1]]
        actual += sum(direct[a, b] for a, b in zip(path, path[1:]))
        assert actual == pytest.approx(expected)
    assert reachable_pairs > 0
    assert len(routes) == reachable_pairs
