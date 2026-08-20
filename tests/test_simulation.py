import numpy as np
from app.core.models import ConstellationConfig, GroundStation, SimulationConfig
from app.core.coverage import station_timeline
from app.core.simulation import run_simulation


def test_kleo_simulation_outputs_are_consistent():
    cfg=ConstellationConfig(888,42,16,16,1,True)
    stations=[GroundStation('Seoul',37.5665,126.978,20)]
    result=run_simulation(SimulationConfig(cfg,stations,30,120))
    assert result['total_satellites']==256
    assert len(result['snapshot'])==256
    assert 0 <= result['coverage_summary']['worst_availability'] <= 1
    assert result['orbital_period_min'] > 90
    assert result['isl']['active_edges'] > 0
    assert 'mean_handovers_per_hour' in result['coverage_summary']
    assert len(result['station_pair_routes']) == 0  # only one station in this test


def test_timeline_length():
    cfg=ConstellationConfig(550,53,8,8,1,False)
    t=np.arange(0,601,60)
    out=station_timeline(cfg,GroundStation('X',0,0,10),t)
    assert len(out['visible_counts'])==11
    assert len(out['min_one_way_propagation_ms'])==11
