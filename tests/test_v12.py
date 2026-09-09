import json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app, _COMPUTE_SLOTS, SETTINGS
from app.core.sampling import sample_times, sampled_metrics
from app.core.coverage import multi_station_summary
from app.core.models import ConstellationConfig, GroundStation
from app.core.heatmap import instantaneous_coverage_heatmap, _ground_grid
from app.core.constellation import satellite_positions_eci

client = TestClient(app, raise_server_exceptions=False)
SMALL = dict(altitudes_km=[888], inclinations_deg=[42], planes_list=[1], sats_per_plane_list=[1], duration_min=1, step_sec=60)

@pytest.mark.parametrize('change', [dict(step_sec=0),dict(duration_min=-1),dict(planes_list=[0]),dict(altitudes_km=[-7000]),dict(inclinations_deg=[999]),dict(min_availability=2),dict(altitudes_km=[]),dict(step_sec='NaN')])
def test_bad_trade_inputs_are_client_errors(change):
    assert client.post('/api/trade-study',json={**SMALL,**change}).status_code == 422

@pytest.mark.parametrize('change', [dict(inclination_deg=999),dict(altitude_km='NaN'),dict(min_elevation_deg=-5),dict(stations=[dict(name='X',lat_deg=91,lon_deg=0)]),dict(coverage_areas=[dict(lat_min=40,lat_max=30,lon_min=120,lon_max=130)])])
def test_invalid_snapshot_inputs(change):
    assert client.post('/api/snapshot',json=dict(heatmap=False,**change)).status_code == 422


def test_outage_is_clipped_to_analysis_window():
    response=client.post('/api/simulate',json=dict(planes=1,sats_per_plane=1,inclination_deg=0,duration_min=2,step_sec=60,stations=[dict(name='Pole',lat_deg=90,lon_deg=0)]))
    assert response.status_code == 200
    row=response.json()['station_timelines'][0]
    assert row['visible_counts']==[0,0,0]
    assert row['max_sampled_outage_sec']==120
    assert row['availability']==0


def test_reconnect_is_not_handover_and_irregular_end_is_weighted():
    times=sample_times(2.5,60)
    assert times.tolist()==[0,60,120,150]
    result=sampled_metrics(['A',None,'B','C'],[1,0,1,1],times)
    assert result['availability']==pytest.approx(0.6)
    assert result['max_sampled_outage_sec']==60
    assert result['handover_count']==1
    assert result['reconnection_count']==1
    assert sample_times(.5,60).tolist()==[0,30]


def test_shared_propagation_once_per_time(monkeypatch):
    import app.core.coverage as mod
    original=mod.satellite_positions_eci;calls=[]
    def counted(cfg,t):
        calls.append(t);return original(cfg,t)
    monkeypatch.setattr(mod,'satellite_positions_eci',counted)
    multi_station_summary(ConstellationConfig(),[GroundStation('A',0,0),GroundStation('B',30,40)],np.array([0.,60.,120.]))
    assert calls==[0,60,120]


def test_chunked_heatmap_matches_independent_dense_geometry():
    sats=satellite_positions_eci(ConstellationConfig(888,42,16,32),123)
    hm=instantaneous_coverage_heatmap(sats,lat_points=15,lon_points=16)
    ground=_ground_grid(np.array(hm['lat_deg']),np.array(hm['lon_deg']))
    los=sats[None,None,:,:]-ground[:,:,None,:]
    elevation=np.degrees(np.arcsin(np.sum(los*(ground/np.linalg.norm(ground,axis=-1,keepdims=True))[:,:,None,:],axis=-1)/np.linalg.norm(los,axis=-1)))
    assert np.array_equal(np.sum(elevation>=20,axis=-1),hm['visible_counts'])


def test_horizon_rule_applies_to_internal_access():
    from app.core.visualization import access_links
    links=access_links(np.array([[7658.137,0,0]]),['X'],[GroundStation('Below',0,36,-5)])
    assert links[0]['visible'] is False


def test_expanded_preset_three_cities_works():
    r=client.post('/api/service-regions/resolve',json=dict(region_codes=['KLEO_EXPANDED'],cities_per_country=3))
    assert r.status_code==200
    selection=r.json();assert len(selection['stations'])==33
    r=client.post('/api/simulate',json=dict(stations=selection['stations'],duration_min=1,step_sec=60))
    assert r.status_code==200
    assert len(r.json()['station_timelines'])==33


def test_busy_server_rejects_work_and_keeps_health_live():
    for _ in range(SETTINGS.max_concurrent_jobs): assert _COMPUTE_SLOTS.acquire(False)
    try:
        assert client.get('/health').status_code==200
        r=client.post('/api/snapshot',json={'heatmap':False})
        assert r.status_code==503 and r.headers['retry-after']=='1'
    finally:
        for _ in range(SETTINGS.max_concurrent_jobs): _COMPUTE_SLOTS.release()
    assert client.post('/api/snapshot',json={'heatmap':False}).status_code==200


def test_comparison_has_six_cases_per_city_metrics_and_reproducibility():
    payload=dict(duration_min=2,step_sec=60,j2=False)
    response=client.post('/api/trade-study',json=payload)
    assert response.status_code==200
    data=response.json();assert len(data['results'])==6
    assert {r['altitude_km'] for r in data['results']}=={500,888,1280}
    assert {r['total_satellites'] for r in data['results']}=={128,256}
    assert all(r['j2'] is False and len(r['station_metrics'])==3 for r in data['results'])
    assert data['analysis_metadata']['availability_basis']=='geometric_visibility'
    assert data['analysis_metadata']['input_sha256']==client.post('/api/trade-study',json=payload).json()['analysis_metadata']['input_sha256']
    qualifying=[r['total_satellites'] for r in data['results'] if r['meets_availability']]
    assert qualifying==sorted(qualifying)


def test_scenario_validation_round_trip():
    payload=dict(schema_version='kleo.scenario.v1',configuration=dict(mode='walker',altitude_km=888,planes=16),selection=dict(country_codes=['KOR','ARE','SGP'],cities_per_country=2),duration_min=120,step_sec=60)
    response=client.post('/api/scenario/validate',json=payload)
    assert response.status_code==200
    saved=response.json()
    assert client.post('/api/scenario/validate',json=saved).json()==saved
    assert saved['configuration']['altitude_km']==888
    assert client.post('/api/scenario/validate',json={**payload,'schema_version':'unknown'}).status_code==422


def test_tle_and_multi_shell_share_outage_definition():
    from app.core.multishell import run_multi_shell_simulation
    from app.core.snapshot import tle_station_timelines
    from app.core.tle import parse_tle_text
    from pathlib import Path
    st=[GroundStation('Pole',90,0,90)]
    m=run_multi_shell_simulation([('SH1','Equatorial',ConstellationConfig(888,0,1,1))],st,2,60)
    assert m['station_timelines'][0]['max_sampled_outage_sec']==120
    tle=Path('examples/vanguard1_verification.tle').read_text()
    t=tle_station_timelines(tle,None,st,2,60)
    assert t['station_timelines'][0]['max_sampled_outage_sec']==120


def test_prefixed_shell_ids_resolve_exactly():
    from app.core.multishell import multi_shell_orbital_geometry
    cfg=ConstellationConfig(888,42,1,1)
    result=multi_shell_orbital_geometry([('SH1','A',cfg),('SH1-A','B',cfg)],'SH1-A-P01-S01',0,ground_track_samples=24)
    assert result['shell_name']=='B'


def test_literal_nan_is_a_validation_error_not_500():
    r=client.post('/api/snapshot',content='{"altitude_km":NaN}',headers={'Content-Type':'application/json'})
    assert r.status_code==422


def test_subnormal_step_is_rejected_before_work_estimation():
    assert client.post('/api/simulate',json={'step_sec':1e-300}).status_code==422


def test_scenario_invalid_tle_timestamp_is_a_client_error():
    from pathlib import Path
    tle=Path('examples/vanguard1_verification.tle').read_text()
    r=client.post('/api/scenario/validate',json={'configuration':{'mode':'tle','tle_text':tle,'start_utc':'not-a-date'},'selection':{'country_codes':['KOR']}})
    assert r.status_code==400
