import numpy as np
from app.core.constants import R_EARTH_KM
from app.core.models import GroundStation, ConstellationConfig
from app.core.ground import elevation_and_range
from app.core.isl import segment_clears_earth, candidate_neighbor_edges


def test_overhead_satellite_is_90deg():
    st=GroundStation('Equator',0,0,0)
    sat=np.array([[R_EARTH_KM+500,0,0]],dtype=float)
    el,r=elevation_and_range(sat,st)
    assert abs(el[0]-90)<1e-10
    assert abs(r[0]-500)<1e-10


def test_antipodal_satellite_blocked_by_earth():
    a=np.array([R_EARTH_KM+500,0,0.0])
    b=-a
    assert not segment_clears_earth(a,b)


def test_neighbor_edge_count_without_duplicates():
    cfg=ConstellationConfig(888,42,16,16,1,False)
    edges=candidate_neighbor_edges(cfg)
    # one unique along-track + one cross-plane edge per satellite for P,S > 2
    assert len(edges)==512
