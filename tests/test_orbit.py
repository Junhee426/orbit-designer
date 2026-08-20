import math
import numpy as np
from app.core.constants import MU_EARTH_KM3_S2, R_EARTH_KM
from app.core.orbit import orbital_period_s, orbital_radius_km
from app.core.models import ConstellationConfig
from app.core.constellation import walker_elements, satellite_positions_eci


def test_period_matches_independent_kepler_formula():
    h=888.0
    a=R_EARTH_KM+h
    expected=2*math.pi*math.sqrt(a**3/MU_EARTH_KM3_S2)
    assert abs(orbital_period_s(h)-expected) < 1e-9


def test_kleo_satellite_count_and_radius():
    cfg=ConstellationConfig(888,42,16,16,1,False)
    pos=satellite_positions_eci(cfg,1234.5)
    assert pos.shape==(256,3)
    radii=np.linalg.norm(pos,axis=1)
    assert np.max(np.abs(radii-orbital_radius_km(888))) < 1e-9


def test_walker_raan_and_inplane_spacing():
    cfg=ConstellationConfig(888,42,16,16,1,False)
    p,s,raan,u0=walker_elements(cfg)
    # First satellite of plane 2 vs plane 1: RAAN separation = 360/16 = 22.5 deg
    i0=np.where((p==0)&(s==0))[0][0]; i1=np.where((p==1)&(s==0))[0][0]
    assert abs(math.degrees(raan[i1]-raan[i0])-22.5)<1e-12
    # Same plane slot spacing = 360/16 = 22.5 deg
    j0=np.where((p==0)&(s==0))[0][0]; j1=np.where((p==0)&(s==1))[0][0]
    assert abs(math.degrees(u0[j1]-u0[j0])-22.5)<1e-12
