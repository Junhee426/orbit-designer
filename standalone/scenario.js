import { DEFAULT_CONFIG, validateConfig, buildConstellations, MODEL_VERSION } from './engine.js';
export const SCHEMA_VERSION = 'kleo.integrated.v2';
export function defaultScenario() {
  return { schema_version:SCHEMA_VERSION, name:'K-LEO 한국 통신망', configuration:structuredClone(DEFAULT_CONFIG),
    selection:{country_codes:['KOR'],cities_per_country:3}, custom_observers:[],
    analysis:{duration_min:1440,step_sec:300}, display:{mode:'3d',earthStyle:'image',orbits:true,isl:false,heatmap:false,footprint:true,time_sec:0,selected_satellite:null,domain:'commNav'}, active_observer:'KOR:0' };
}
function object(value,label) { if(!value || typeof value!=='object' || Array.isArray(value)) throw Error(label+' 형식을 확인해 주세요.'); }
function keys(value,allowed,label) {object(value,label);if(Object.keys(value).some(k=>!allowed.includes(k))) throw Error(label+'에 알 수 없는 항목이 있습니다.');}
export function observersFor(scenario,catalog) {
  return [...scenario.selection.country_codes.flatMap(code=>{
    const c=catalog.countries.find(c=>c.code===code);
    if(!c) throw Error('지원하지 않는 국가: '+code);
    return c.cities.slice(0,scenario.selection.cities_per_country).map((city,i)=>({id:`${code}:${i}`,name:city.name,lat:city.lat_deg,lon:city.lon_deg,country:code}));
  }),...scenario.custom_observers];
}
export function validateScenario(input,catalog) {
  keys(input,['schema_version','name','configuration','selection','custom_observers','analysis','display','active_observer'],'시나리오');
  if(input.schema_version!==SCHEMA_VERSION) throw Error('지원하지 않는 시나리오 버전');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120) throw Error('시나리오 이름은 1–120자입니다.');
  const s=structuredClone(input); s.configuration=validateConfig(s.configuration);
  keys(s.selection,['country_codes','cities_per_country'],'국가 선택');
  const codes=s.selection.country_codes;
  if(!Array.isArray(codes)||codes.length>18||codes.some(c=>typeof c!=='string')||new Set(codes).size!==codes.length) throw Error('국가 선택을 확인해 주세요.');
  if(!Number.isInteger(s.selection.cities_per_country)||s.selection.cities_per_country<1||s.selection.cities_per_country>3) throw Error('국가당 관측지는 1–3개입니다.');
  if(!Array.isArray(s.custom_observers)||s.custom_observers.length>16) throw Error('직접 입력 관측지는 최대 16개입니다.');
  for(const o of s.custom_observers) {
    keys(o,['id','name','lat','lon'],'관측지');
    if(typeof o.id!=='string'||!/^custom:[\w-]{1,40}$/.test(o.id)||typeof o.name!=='string'||!o.name.trim()||o.name.length>120||!Number.isFinite(o.lat)||Math.abs(o.lat)>90||!Number.isFinite(o.lon)||Math.abs(o.lon)>180) throw Error('직접 입력 관측지 이름·좌표를 확인해 주세요.');
  }
  const observers=observersFor(s,catalog);
  if(!observers.length||observers.length>64||new Set(observers.map(o=>o.id)).size!==observers.length) throw Error('서로 다른 관측지 1–64개가 필요합니다.');
  if(!observers.some(o=>o.id===s.active_observer)) s.active_observer=observers[0].id;
  keys(s.analysis,['duration_min','step_sec'],'분석');
  if(!Number.isFinite(s.analysis.duration_min)||s.analysis.duration_min<=0||s.analysis.duration_min>1440||!Number.isFinite(s.analysis.step_sec)||s.analysis.step_sec<1||s.analysis.step_sec>3600) throw Error('분석 기간은 0–1440분, 간격은 1–3600초입니다.');
  const samples=sampleTimes(s.analysis.duration_min,s.analysis.step_sec);
  const count=buildConstellations(s.configuration).length;
  if(samples.length>3001||samples.length*count*observers.length>30_000_000) throw Error('분석량 한도 초과: 시간 간격을 늘리거나 위성·관측지를 줄여 주세요.');
  keys(s.display,['mode','earthStyle','orbits','isl','heatmap','footprint','time_sec','selected_satellite','domain'],'표시');
  s.display.earthStyle??='image';s.display.time_sec??=0;s.display.selected_satellite??=null;s.display.domain??='commNav';
  s.display.mode={'3D':'3d','2D':'2d'}[s.display.mode]??s.display.mode;
  if(!Number.isFinite(s.display.time_sec)||s.display.time_sec<0||s.display.time_sec>s.analysis.duration_min*60||s.display.selected_satellite!==null&&typeof s.display.selected_satellite!=='string') throw Error('저장된 지도 시각·위성 선택이 유효하지 않습니다.');
  if(!['3d','2d','2d-globe','2d-map'].includes(s.display.mode)||!['image','outline'].includes(s.display.earthStyle)||!['comm','commNav'].includes(s.display.domain)||['orbits','isl','heatmap','footprint'].some(k=>typeof s.display[k]!=='boolean')) throw Error('지도 표시 설정을 확인해 주세요.');
  return s;
}
export function sampleTimes(durationMin,stepSec) {
  const end=durationMin*60;
  if(!Number.isFinite(end)||end<=0||!Number.isFinite(stepSec)||stepSec<=0||Math.ceil(end/stepSec)>3000) throw Error('분석 시간·표본 수를 확인해 주세요.');
  const times=[];for(let t=0;t<end;t+=stepSec) times.push(t);
  times.push(end);return times;
}
function convertOrbit(c) {return {altitude:c.altitude_km,inclination:c.inclination_deg,planes:c.planes,satellitesPerPlane:c.sats_per_plane,phasing:c.phasing,j2:c.j2};}
export function importScenario(input,catalog) {
  object(input,'설정');
  if(input.schema_version===SCHEMA_VERSION) return validateScenario(input,catalog);
  const s=defaultScenario();
  if(input.schema_version==='kleo.scenario.v1') {
    const c=input.configuration;object(c,'기존 설정');
    const old=Object.fromEntries(Object.entries(convertOrbit(c)).filter(([,v])=>v!==undefined));
    s.name=input.name||s.name;
    s.configuration={...s.configuration,...old,mode:c.mode||'walker',tleText:c.tle_text||'',startUtc:c.start_utc||'',shells:(c.shells||[]).map((v,i)=>({id:v.id||`SH${i+1}`,...convertOrbit(v)}))};
    s.analysis={duration_min:input.duration_min,step_sec:input.step_sec};
    s.selection={country_codes:input.selection?.country_codes||[],cities_per_country:Math.min(3,input.selection?.cities_per_country||3)};
    // Preserve explicit stations; country presets must not replace arbitrary coordinates.
    if(c.stations?.length) {s.selection.country_codes=[];s.custom_observers=c.stations.map((o,i)=>({id:`custom:import-${i}`,name:o.name,lat:o.lat_deg,lon:o.lon_deg}));}
    s.configuration.commElevation=c.min_elevation_deg??20;
    s.display.time_sec=Math.min(c.time_sec??0,s.analysis.duration_min*60);
    s.display.orbits=c.include_orbits??true;s.display.isl=c.include_isl??false;s.display.heatmap=c.heatmap??false;
  } else if(!input.schema_version) {
    // Old commnav JSON has no J2 field: preserve the old numerical model explicitly.
    s.configuration=validateConfig({...DEFAULT_CONFIG,altitude:888,planes:16,j2:false,...input});
    const c=s.configuration;
    const locations={seoul:['서울',37.5665,126.978],busan:['부산',35.1796,129.0756],jeju:['제주',33.4996,126.5312],abudhabi:['Abu Dhabi',24.4539,54.3773],singapore:['Singapore',1.3521,103.8198],jakarta:['Jakarta',-6.2088,106.8456]};
    const [name,lat,lon]=c.location==='custom'?['직접 입력',c.latitude,c.longitude]:locations[c.location];
    s.selection.country_codes=[];s.custom_observers=[{id:'custom:commnav',name,lat,lon}];
  } else throw Error('지원하지 않는 시나리오 버전');
  return validateScenario(s,catalog);
}
export function canonicalJSON(value) {return JSON.stringify(sort(value));}
function sort(v) {return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export function analysisKey(s) {return canonicalJSON({configuration:s.configuration,selection:s.selection,custom_observers:s.custom_observers,analysis:s.analysis});}
export async function metadata(s) {
  const bytes=new TextEncoder().encode(analysisKey(s));
  const hash=globalThis.crypto?.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''):null;
  return {model_version:MODEL_VERSION,schema_version:SCHEMA_VERSION,input_sha256:hash,generated_utc:new Date().toISOString(),
    time_basis:s.configuration.mode==='tle'?'UTC / TEME to ECEF (GMST approximation)':'relative seconds; Earth angle 0 at t=0',
    walker_model:'circular two-body + optional J2 RAAN drift',sampling_method:'left_hold_intervals',
    availability_units:'percent',geometric_basis:'at least one satellite above commElevation',
    service_basis:'separate throughput, HRMS, and joint thresholds',median_basis:'valid samples excluding zero-duration endpoint',
    limitations:['Spherical Earth','Idealized GNSS/regional constellations','No rain time series, network capacity, tracking, or integrity guarantee','Outages shorter than the time step may be missed']};
}
