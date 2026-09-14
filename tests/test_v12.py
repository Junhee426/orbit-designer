import json
import threading
import numpy as np
import pytest
from fastapi.testclient import TestClient
import app.main as main_module
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
    original=mod.satellite_states_ecef;calls=[]
    def counted(cfg,times_sec,**kw):
        calls.append(np.asarray(times_sec).tolist());return original(cfg,times_sec,**kw)
    monkeypatch.setattr(mod,'satellite_states_ecef',counted)
    multi_station_summary(ConstellationConfig(),[GroundStation('A',0,0),GroundStation('B',30,40)],np.array([0.,60.,120.]))
    assert [t for call in calls for t in call]==[0,60,120]
    assert len(calls)==1  # small enough to fit in a single chunk, regardless of station count


def test_walker_elements_computed_once_per_summary(monkeypatch):
    import app.core.coverage as mod
    original=mod.walker_elements;calls=[]
    def counted(cfg):
        calls.append(cfg);return original(cfg)
    monkeypatch.setattr(mod,'walker_elements',counted)
    multi_station_summary(ConstellationConfig(),[GroundStation('A',0,0),GroundStation('B',30,40)],np.array([0.,60.,120.]))
    assert len(calls)==1


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
    for _ in range(SETTINGS.max_concurrent_jobs_per_worker): assert _COMPUTE_SLOTS.acquire(False)
    try:
        assert client.get('/health').status_code==200
        rejected_before=main_module._rejected_jobs_total
        r=client.post('/api/snapshot',json={'heatmap':False})
        assert r.status_code==503 and r.headers['retry-after']=='1'
        assert main_module._rejected_jobs_total==rejected_before+1
    finally:
        for _ in range(SETTINGS.max_concurrent_jobs_per_worker): _COMPUTE_SLOTS.release()
    assert client.post('/api/snapshot',json={'heatmap':False}).status_code==200


def test_server_info_reports_current_load_not_just_static_limits():
    accepted_before=main_module._accepted_jobs_total
    r=client.get('/api/server-info')
    assert r.status_code==200
    load=r.json()['load']
    assert load['max_concurrent_jobs_this_worker']==SETTINGS.max_concurrent_jobs_per_worker
    assert load['active_jobs_this_worker']==0
    assert load['available_slots_this_worker']==SETTINGS.max_concurrent_jobs_per_worker
    client.post('/api/snapshot',json={'heatmap':False})
    assert main_module._accepted_jobs_total==accepted_before+1
    assert client.get('/api/server-info').json()['load']['active_jobs_this_worker']==0


def test_load_counters_reflect_in_flight_job_while_it_runs():
    # A slow bounded_compute-wrapped call occupies a slot; server-info
    # observed concurrently must show it as active with fewer available
    # slots, proving the counter is visible mid-job rather than only
    # updated after completion (which the accepted/rejected totals alone
    # would not demonstrate).
    started=threading.Event()
    release=threading.Event()

    @main_module.bounded_compute
    def slow(req):
        started.set()
        release.wait(timeout=5)
        return {"ok": True}

    t=threading.Thread(target=slow, args=(None,))
    try:
        t.start()
        assert started.wait(timeout=5)
        info=client.get('/api/server-info').json()['load']
        assert info['active_jobs_this_worker']>=1
        assert info['available_slots_this_worker']==SETTINGS.max_concurrent_jobs_per_worker-info['active_jobs_this_worker']
    finally:
        release.set()
        t.join(timeout=5)
    assert client.get('/api/server-info').json()['load']['active_jobs_this_worker']==0


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


def test_include_routes_workload_accounts_for_station_pair_routing(monkeypatch):
    from dataclasses import replace
    import app.main as main
    from fastapi import HTTPException
    from app.main import SimIn, _enforce_sim_limits
    # The merged implementation shares Dijkstra searches across destinations.
    # Use a fixed budget between propagation-only and routing workloads.
    monkeypatch.setattr(main, 'SETTINGS', replace(SETTINGS, max_sim_work=1_000_000))
    stations=[dict(name=f"S{i}",lat_deg=0.0,lon_deg=float(i),min_elevation_deg=10) for i in range(64)]
    req=SimIn(planes=64,sats_per_plane=64,duration_min=1,step_sec=60,stations=stations,include_routes=True)
    with pytest.raises(HTTPException):
        _enforce_sim_limits(req,req.planes*req.sats_per_plane)
    # Same size and station count without routing stays under the same workload budget.
    req_no_routes=req.model_copy(update={'include_routes':False})
    _enforce_sim_limits(req_no_routes,req_no_routes.planes*req_no_routes.sats_per_plane)


def test_scenario_validation_rejects_tle_mode_heatmap_workload_like_walker_mode():
    from pathlib import Path
    tle=Path('examples/vanguard1_verification.tle').read_text()
    payload=dict(configuration=dict(mode='tle',tle_text=tle,heatmap=True,heatmap_points=SETTINGS.max_heatmap_points+1),selection=dict(country_codes=['KOR']))
    r=client.post('/api/scenario/validate',json=payload)
    assert r.status_code==413


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


@pytest.mark.parametrize('mode', ['walker', 'multi_shell', 'tle'])
def test_scenario_checks_heatmap_work_after_resolving_selection(monkeypatch, mode):
    from dataclasses import replace
    from pathlib import Path
    import app.main as main

    monkeypatch.setattr(main, 'SETTINGS', replace(SETTINGS, max_snapshot_work=1000))
    configuration = dict(
        mode=mode, planes=1, sats_per_plane=1, heatmap=True, heatmap_points=28,
        shells=[dict(planes=1, sats_per_plane=1)],
        tle_text=Path('examples/vanguard1_verification.tle').read_text(),
    )
    payload = dict(configuration=configuration,
                   selection=dict(country_codes=['KOR'], cities_per_country=1),
                   duration_min=1, step_sec=60)
    accepted = client.post('/api/scenario/validate', json=payload)
    assert accepted.status_code == 200
    payload['selection']['country_codes'].append('JPN')
    rejected = client.post('/api/scenario/validate', json=payload)
    assert rejected.status_code == 413
    assert 'Snapshot workload' in rejected.json()['detail']


def test_tle_scenario_checks_snapshot_resolution_limit():
    from pathlib import Path

    response = client.post('/api/scenario/validate', json=dict(
        configuration=dict(mode='tle', heatmap_points=SETTINGS.max_heatmap_points + 1,
                           tle_text=Path('examples/vanguard1_verification.tle').read_text()),
        selection=dict(country_codes=['KOR']),
    ))
    assert response.status_code == 413
