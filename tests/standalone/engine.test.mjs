import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_CONFIG,buildConstellations,orbitState,observerFrame,observe,statesAt,geometryAt,evaluateSnapshot,compactSample,linkBudget,positionAccuracy,parseTLE,validateConfig} from '../../standalone/engine.js';
import {intervalSummary,analyze,tradeStudy} from '../../standalone/analysis.js';
import {defaultScenario,validateScenario,importScenario,observersFor,sampleTimes,analysisKey} from '../../standalone/scenario.js';
import {islEdges,routeBetween,footprint,coverageGrid,insideGeometry} from '../../standalone/geometry.js';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const reference=read('./reference.json'),catalog=read('../../standalone/catalog.json');
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('J2 on/off positions and full-day geometric metrics match the Python engine',()=>{
  for(const c of reference.walker){const cfg={...DEFAULT_CONFIG,altitude:c.altitude,j2:c.j2};const orbits=buildConstellations(cfg);
    c.times.forEach((t,i)=>c.indices.forEach((index,k)=>orbitState(orbits[index],t).position.forEach((v,j)=>close(v,c.positions[i][k][j],1e-7))));
    const samples=sampleTimes(1440,300).map(t=>compactSample(evaluateSnapshot(cfg,geometryAt(statesAt(orbits,t/60),{lat:37.5665,lon:126.978},t/60))));
    const summary=intervalSummary(samples,cfg),expected=c.summary;
    close(summary.geometricAvailability/100,expected.availability);close(summary.avgVisible,expected.avg_visible);assert.equal(summary.maxVisible,expected.max_visible);assert.equal(summary.handovers,expected.handover_count);assert.equal(summary.reconnects,expected.reconnection_count);close(summary.longestOutageSec,expected.max_sampled_outage_sec);
  }
});
test('J2 ECEF velocities and Doppler range rates match central differences',()=>{
  const frame=observerFrame(37.5665,126.978);
  for(const inclination of [0,42,98,180])for(const j2 of [false,true]){
    const orbit=buildConstellations({...DEFAULT_CONFIG,inclination,j2})[42],t=43200,dt=.05,a=orbitState(orbit,t-dt),b=orbitState(orbit,t+dt),center=orbitState(orbit,t);
    center.velocity.forEach((v,i)=>close(v,(b.position[i]-a.position[i])/(2*dt),1e-7));close(observe(center,frame).rangeRate,(observe(b,frame).range-observe(a,frame).range)/(2*dt),1e-7);
  }
});
test('TLE matches the Python SGP4 reference and does not apply Walker J2 twice',()=>{
  const cfg={...DEFAULT_CONFIG,mode:'tle',tleText:reference.tle.text,startUtc:reference.tle.epoch},o=buildConstellations(cfg)[0],s=orbitState(o,0);
  s.inertial.forEach((v,i)=>close(v,reference.tle.teme[i],.001));s.position.forEach((v,i)=>close(v,reference.tle.ecef[i],.001));
  assert.deepEqual(orbitState(buildConstellations({...cfg,j2:false})[0],0).position,s.position);
  assert.throws(()=>parseTLE('broken'));assert.throws(()=>parseTLE(reference.tle.text+'\n'+reference.tle.text));
});
test('RF margin matches original link budget with explicitly mapped G/T and losses',()=>{
  const b=linkBudget({range:1500,rangeRate:1,payload:true},DEFAULT_CONFIG);
  close(b.fspl,reference.link.fspl_db);close(b.cn0,reference.link.cn0_dbhz);close(b.ebn0,reference.link.ebn0_db);close(b.margin,reference.link.margin_db);
  const shared=linkBudget({range:1500,rangeRate:1,payload:true},{...DEFAULT_CONFIG,sharing:'time',navShare:20});close(shared.mbps,.8*b.mbps);
});
test('navigation covariance retains the independent NumPy reference and rejects singular geometry',()=>{
  const sightline=(a,e)=>{a*=Math.PI/180;e*=Math.PI/180;return [Math.cos(e)*Math.sin(a),Math.cos(e)*Math.cos(a),Math.sin(e)];};
  const m=[[15,65],[60,30],[105,45],[150,20],[195,60],[240,35],[285,25],[330,50]].map(([a,e])=>({group:'GNSS',sigma:3,losENU:sightline(a,e)}));
  close(positionAccuracy(m).hrms,2.981276900100016,1e-9);assert.equal(positionAccuracy([]).hrms,null);assert.equal(positionAccuracy(Array.from({length:6},()=>m[0])).valid,false);
});
test('nonuniform endpoint weighting, missing navigation, handover and reconnect definitions',()=>{
  const sample=(minutes,id,nav)=>({minutes,commVisible:id?1:0,geometricBestId:id,bestId:id,hrms:nav?1:null,baseline:null,gnssLEO:null,rate:0,commPass:false,navPass:nav,jointPass:false});
  const summary=intervalSummary([sample(0,'a',true),sample(1,null,false),sample(2,'b',false),sample(2.5,'c',true)],DEFAULT_CONFIG);
  close(summary.geometricAvailability,60);close(summary.navAvailability,40);assert.equal(summary.longestOutageSec,60);assert.equal(summary.reconnects,1);assert.equal(summary.handovers,1);close(summary.medianHrms,1);
  assert.deepEqual(sampleTimes(2.5,60),[0,60,120,150]);assert.throws(()=>sampleTimes(1440,1));
});
test('scenario v2 preserves custom observers and defaults only to Korea',()=>{
  const s=defaultScenario();assert.deepEqual(s.selection.country_codes,['KOR']);s.custom_observers=[{id:'custom:site',name:'남쪽 지점',lat:-25.5,lon:179.9}];s.active_observer='custom:site';s.configuration.navShare=22;s.display.earthStyle='outline';
  const restored=importScenario(JSON.parse(JSON.stringify(s)),catalog);assert.deepEqual(restored,validateScenario(s,catalog));assert.equal(observersFor(restored,catalog).at(-1).lat,-25.5);
  const display=structuredClone(s);display.display.mode='2D';assert.equal(analysisKey(display),analysisKey(s));display.configuration.j2=false;assert.notEqual(analysisKey(display),analysisKey(s));
});
test('legacy scenario imports preserve explicit coordinates and unknown versions fail',()=>{
  const v1=read('../../examples/scenario_v1_2.json');v1.configuration.stations=[{name:'User',lat_deg:1.234,lon_deg:5.678}];
  const s=importScenario(v1,catalog);assert.equal(s.custom_observers[0].lat,1.234);assert.deepEqual(s.selection.country_codes,[]);
  assert.throws(()=>importScenario({schema_version:'future'},catalog));assert.throws(()=>validateConfig({extra:4}));
  const old=importScenario({},catalog);assert.equal(old.configuration.altitude,888);assert.equal(old.configuration.planes,16);assert.equal(old.configuration.j2,false);
});
test('multi-shell propagates each J2 setting and does not connect shells',()=>{
  const shells=[{id:'A',altitude:500,inclination:42,planes:4,satellitesPerPlane:8,phasing:1,j2:true},{id:'B',altitude:1280,inclination:70,planes:4,satellitesPerPlane:8,phasing:2,j2:false}];
  const orbits=buildConstellations({...DEFAULT_CONFIG,mode:'multi_shell',shells}),states=statesAt(orbits,120),edges=islEdges(states);
  assert.equal(orbits.filter(o=>o.group==='LEO').length,64);assert.ok(orbits[0].raanRate!==0);assert.equal(orbits[32].raanRate,0);assert.ok(edges.every(e=>e.a[0]===e.b[0]));
  assert.throws(()=>buildConstellations({...DEFAULT_CONFIG,mode:'multi_shell',shells:[shells[0],shells[0]]}));
});
test('ISL routing, horizon footprint and bounded grids use actual geometry',()=>{
  const states=statesAt(buildConstellations(DEFAULT_CONFIG),0),from={lat:37.5665,lon:126.978,name:'Seoul'},to={lat:35.1796,lon:129.0756,name:'Busan'};
  const route=routeBetween(states,islEdges(states),from,to,20);assert.ok(route&&route.delayMs>0);assert.ok(route.path.length>=1);
  assert.equal(footprint(states[0].position,20).length,73);
  const country=catalog.countries.find(c=>c.code==='KOR'),grid=coverageGrid(states,country,20,null,4);assert.equal(grid.length,16);assert.ok(grid.every(c=>c.count>=0));
  assert.equal(insideGeometry(1,1,{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}),true);
});
test('all observers receive period results and every candidate uses the same period',async()=>{
  const s=defaultScenario();s.analysis={duration_min:10,step_sec:60};const r=await analyze(s,catalog);assert.equal(r.observers.length,3);assert.equal(r.observers[0].samples.length,11);assert.equal(r.metadata.sampling_method,'left_hold_intervals');assert.equal(r.metadata.input_sha256.length,64);
  const trade=await tradeStudy(s,catalog);assert.equal(trade.candidates.length,6);assert.equal(trade.scenario.analysis.duration_min,10);
});
