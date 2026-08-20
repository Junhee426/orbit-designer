import math
from app.core.link_budget import fspl_db, downlink_margin_db
from app.core.models import LinkBudgetConfig


def test_fspl_against_direct_formula():
    R_km=1000.0; f_ghz=20.0
    c=299792458.0
    lam=c/(f_ghz*1e9)
    expected=20*math.log10(4*math.pi*(R_km*1000)/lam)
    assert abs(fspl_db(R_km,f_ghz)-expected) < 0.02


def test_link_margin_falls_with_range():
    cfg=LinkBudgetConfig()
    near=downlink_margin_db(800,cfg)['margin_db']
    far=downlink_margin_db(1800,cfg)['margin_db']
    assert near>far
