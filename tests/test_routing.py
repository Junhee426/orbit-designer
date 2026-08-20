import numpy as np
from app.core.models import ConstellationConfig, GroundStation
from app.core.constellation import satellite_positions_eci
from app.core.orbit import eci_to_ecef
from app.core.routing import minimum_station_pair_route


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
