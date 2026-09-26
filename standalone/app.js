import {DEFAULT_CONFIG,MODEL_VERSION,buildConstellations,statesAt,geometryAt,evaluateSnapshot,parameterSweep} from './engine.js';
import {defaultScenario,validateScenario,importScenario,observersFor,analysisKey} from './scenario.js';
import {skyPlot,lineChart} from './rendering.js';
import {islEdges,routeBetween,coverageGrid} from './geometry.js';
import {OrbitViewer} from './viewer.js';
import {sortTradeCandidates} from './analysis.js';
import {loadSession,saveSession} from './session.js';

const $=id=>document.getElementById(id);
const [catalog,boundaries,worldOutline]=await Promise.all([fetch(new URL('./catalog.json',import.meta.url)).then(r=>r.json()),fetch(new URL('./boundaries.geojson',import.meta.url)).then(r=>r.json()),fetch(new URL('./world.json',import.meta.url)).then(r=>r.json())]);
let scenario=defaultScenario(),orbits=[],observers=[],current=null,seconds=0,selected=null,worker=null,job=0,playing=null,editing=null,result=null,tradeResult=null,view='design',domain='commNav';
let lastOrbitKey='',lastSatKey='';
let sessionReady=false,sessionDirty=false,saveTimer=null;
function persistSession(){
  clearTimeout(saveTimer);if(!sessionReady||!sessionDirty)return;
  let valid;
  try{valid=readForm();}catch{text('save-status','입력 확인 필요 · 마지막 유효 설정 유지');return;}
  try{saveSession(localStorage,valid,s=>s);sessionDirty=false;text('save-status','이 기기에 자동 저장됨');$('save-status').dataset.state='saved';}
  catch{text('save-status','자동 저장 불가 · 설정 파일로 저장하세요');$('save-status').dataset.state='error';}
}
function scheduleSave(){if(sessionReady){sessionDirty=true;clearTimeout(saveTimer);text('save-status','설정 저장 중…');saveTimer=setTimeout(persistSession,500);}}
const format=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const hms=t=>[Math.floor(t/3600),Math.floor(t/60)%60,Math.floor(t)%60].map(v=>String(v).padStart(2,'0')).join(':');
const error=message=>{$('error').textContent=message||'';$('error').hidden=!message;};
const text=(id,v)=>$(id).textContent=v;
function option(value,label){const e=document.createElement('option');e.value=value;e.textContent=label;return e;}
function field(container,key,label,type='number',extra={}){
  const wrap=document.createElement('label');wrap.className='field';const span=document.createElement('span');span.textContent=label;wrap.append(span);
  const el=document.createElement(type==='select'?'select':'input');
  if(type!=='select')el.type=type;else for(const [value,title]of extra.options)el.append(option(value,title));
  el.dataset.config=key;el.name=key;if(type==='number'){el.step='any';if(extra.min!==undefined)el.min=extra.min;if(extra.max!==undefined)el.max=extra.max;}
  wrap.append(el);container.append(wrap);return el;
}
const modeInput=field($('orbit-fields'),'mode','궤도 모델','select',{options:[['walker','단일 Walker'],['multi_shell','다층 Walker'],['tle','TLE / SGP4']]});
for(const [key,label,min,max]of [['altitude','고도 (km)',160,3000],['inclination','경사각 (°)',0,180],['planes','궤도면 수',1,128],['satellitesPerPlane','면당 위성 수',1,256],['phasing','Walker F',0,127]])field($('orbit-fields'),key,label,'number',{min,max});
field($('orbit-fields'),'j2','J2 RAAN 보정','checkbox');
for(const [key,label,min,max]of [
  ['commElevation','통신 최소 고도각 (°)',0,90],['rateTarget','통신 목표 (Mbps 이상)',1,1000]
])field($('comm-fields'),key,label,'number',{min,max});
for(const [key,label,min,max]of [
  ['eirp','EIRP (dBW)',20,65],['gt','수신 G/T (dB/K)',-10,30],['bandwidth','대역폭 (MHz)',1,500],['frequency','주파수 (GHz)',10,40],['rainLoss','강우손실 (dB)',0,40],['otherLoss','기타손실 (dB)',0,50],['dataRate','마진 기준 데이터율 (Mbps)',.1,10000],['requiredEbn0','요구 Eb/N0 (dB)',-20,40]
])field($('rf-fields'),key,label,'number',{min,max});
for(const [key,label,type,extra]of [
  ['navElevation','항법 최소 고도각 (°)','number',{min:0,max:90}],['leoNav','LEO 항법 탑재체 사용','checkbox',{}],
  ['payloadPercent','항법 탑재 위성 비율 (%)','number',{min:0,max:100}],['regional','지역항법 8기 예시 추가','checkbox',{}],
  ['sharing','신호 구성','select',{options:[['separate','신호 분리'],['time','시간 공유']]}],['navShare','항법 시간 배정 (%)','number',{min:0,max:40}],
  ['horizontalTarget','수평 RMS 목표 (m 이하)','number',{min:.1,max:100}]
])field($('nav-fields'),key,label,type,extra);
for(const [key,label,min,max]of [
  ['gnssSigma','GNSS 거리오차 (m)',.1,30],['leoSigma','LEO 잡음 / 1,000 km (m)',.1,30],['orbitSigma','LEO 궤도오차 (m)',0,30],['clockNs','LEO 시계오차 (ns)',0,1000]
])field($('nav-error-fields'),key,label,'number',{min,max});
for(const c of catalog.countries){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=c.code;input.dataset.country=c.code;label.append(input,document.createTextNode(c.name_ko));$('countries').append(label);}

function rowInput(row,key,value,type='number') {const label=document.createElement('label');label.className='field';label.textContent=({id:'층 ID (영문·숫자)',altitude:'고도 (km)',inclination:'경사각 (°)',planes:'궤도면 수',satellitesPerPlane:'면당 위성 수',phasing:'Walker F',j2:'J2 RAAN 보정',name:'관측지 이름',lat:'위도 (°)',lon:'경도 (°)'})[key]||key;const input=document.createElement('input');input.type=type;input.dataset.key=key;if(type==='checkbox')input.checked=value;else input.value=value;input.step='any';label.append(input);row.append(label);return input;}
function addShellRow(shell){const row=document.createElement('div');row.className='shell';const remove=document.createElement('button');remove.type='button';remove.className='remove-row';remove.textContent='삭제';remove.addEventListener('click',()=>{row.remove();applyInputs();});row.append(remove);
  for(const key of ['id','altitude','inclination','planes','satellitesPerPlane','phasing','j2'])rowInput(row,key,shell[key],key==='id'?'text':key==='j2'?'checkbox':'number');$('shells').append(row);
}
function addObserverRow(o){const row=document.createElement('div');row.className='custom-observer';row.dataset.id=o.id;const remove=document.createElement('button');remove.type='button';remove.className='remove-row';remove.textContent='삭제';remove.addEventListener('click',()=>{row.remove();applyInputs();});row.append(remove);for(const k of ['name','lat','lon'])rowInput(row,k,o[k],k==='name'?'text':'number');$('custom-observers').append(row);}
function readRows(selector){return [...document.querySelectorAll(selector)].map(row=>Object.fromEntries([...row.querySelectorAll('[data-key]')].map(el=>[el.dataset.key,el.type==='checkbox'?el.checked:el.type==='number'?(el.value.trim()===''?NaN:Number(el.value)):el.value])));}
function syncForm(){
  text('status','설정을 확인하고 분석을 실행하세요.');$('scenario-name').value=scenario.name;
  for(const el of document.querySelectorAll('[data-config]')){if(el.type==='checkbox')el.checked=scenario.configuration[el.dataset.config];else el.value=scenario.configuration[el.dataset.config];}
  for(const el of document.querySelectorAll('[data-country]'))el.checked=scenario.selection.country_codes.includes(el.value);
  $('city-count').value=scenario.selection.cities_per_country;$('duration').value=scenario.analysis.duration_min;$('step').value=scenario.analysis.step_sec;
  $('tle-text').value=scenario.configuration.tleText;$('start-utc').value=scenario.configuration.startUtc;
  $('shells').replaceChildren();scenario.configuration.shells.forEach(addShellRow);
  $('custom-observers').replaceChildren();scenario.custom_observers.forEach(addObserverRow);
  $('map-mode').value=scenario.display.mode;$('earth-style').value=scenario.display.earthStyle;for(const k of ['orbits','isl','heatmap','footprint'])$('show-'+k).checked=scenario.display[k];
  $('sat-shape').value=scenario.display.satShape;$('sat-size').value=scenario.display.satSize;text('sat-size-value',scenario.display.satSize.toFixed(2)+'×');
  $('orbit-width').value=scenario.display.orbitWidth;text('orbit-width-value',scenario.display.orbitWidth.toFixed(1)+'×');
  modeFields();
}
function modeFields(){const mode=modeInput.value;$('shell-section').hidden=mode!=='multi_shell';$('tle-section').hidden=mode!=='tle';
  for(const el of $('orbit-fields').querySelectorAll('[data-config]'))if(el!==modeInput){el.parentElement.hidden=mode!=='walker';el.disabled=mode!=='walker';}
}
function readForm(){const s=structuredClone(scenario);s.name=$('scenario-name').value;
  for(const el of document.querySelectorAll('[data-config]'))if(!el.disabled)s.configuration[el.dataset.config]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value.trim()===''?NaN:Number(el.value)):el.value;
  s.configuration.shells=readRows('.shell');s.configuration.tleText=$('tle-text').value;s.configuration.startUtc=$('start-utc').value.trim();
  s.selection={country_codes:[...document.querySelectorAll('[data-country]:checked')].map(el=>el.value),cities_per_country:Number($('city-count').value)};
  s.custom_observers=readRows('.custom-observer').map((o,i)=>({...o,id:document.querySelectorAll('.custom-observer')[i].dataset.id}));
  s.analysis={duration_min:Number($('duration').value),step_sec:Number($('step').value)};
  s.display.time_sec=Math.min(seconds,s.analysis.duration_min*60);
  return validateScenario(s,catalog);
}
function applyInputs(){clearTimeout(editing);try{const next=readForm();scenario=next;refreshConfiguration();error('');return true;}catch(e){error(e.message);if(sessionReady)text('save-status','입력 확인 필요 · 마지막 유효 설정 유지');return false;}}
function refreshConfiguration(){
  const orbitKey=JSON.stringify(scenario.configuration);if(orbitKey!==lastOrbitKey){orbits=buildConstellations(scenario.configuration);lastOrbitKey=orbitKey;}
  observers=observersFor(scenario,catalog);$('observer').replaceChildren(...observers.map(o=>option(o.id,o.name)));$('observer').value=scenario.active_observer;
  $('route-target').replaceChildren(...observers.filter(o=>o.id!==scenario.active_observer).map(o=>option(o.id,o.name)));$('route').disabled=observers.length<2;
  seconds=Math.min(seconds,scenario.analysis.duration_min*60);$('time').max=scenario.analysis.duration_min*60;
  const cfg=scenario.configuration,total=orbits.filter(o=>o.group==='LEO').length;
  text('orbit-note',`${total.toLocaleString()}기 · ${cfg.mode==='tle'?'SGP4 (J2 중복 적용 없음)':cfg.mode==='multi_shell'?`${cfg.shells.length}개 층 · 층별 J2 설정`:`Walker F=${cfg.phasing} · J2 ${cfg.j2?'켜짐':'꺼짐'}`}`);
  text('analysis-config',`${cfg.mode==='tle'?'TLE / SGP4':cfg.mode==='multi_shell'?`Multi-shell · ${cfg.shells.length}개 층`:`Walker-Delta · ${format(cfg.altitude,0)} km · 경사각 ${format(cfg.inclination,1)}°`} · 총 ${total.toLocaleString()}기`);
  text('nav-extension-state',cfg.leoNav?`LEO 항법 ${format(cfg.payloadPercent,0)}% · ${cfg.regional?'지역항법 포함':'GNSS 융합'}`:'GNSS 기준 · LEO 항법 꺼짐');
  text('map-title',`${total.toLocaleString()}기 · ${cfg.mode==='tle'?'TLE / SGP4':cfg.mode==='multi_shell'?'Multi-shell':cfg.altitude.toLocaleString()+' km'}`);
  const satKey=orbits.map(o=>o.id).join('|');if(satKey!==lastSatKey){$('satellite').replaceChildren(option('','선택 안 함'),...orbits.filter(o=>o.group==='LEO').map(o=>option(o.id,o.name||o.id)));lastSatKey=satKey;}
  if(selected!==null&&!orbits.some(o=>o.id===selected))selected=null;$('satellite').value=selected??'';
  $('run-trade').disabled=!!worker||cfg.mode!=='walker';modeFields();draw();renderResults();renderTrade();
}
function activeObserver(){return observers.find(o=>o.id===scenario.active_observer)||observers[0];}
function cards(id,items){$(id).replaceChildren(...items.map(([label,value,unit='',note=''])=>{const a=document.createElement('article');a.className='metric';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;const u=document.createElement('small');u.textContent=' '+unit;v.append(u);const p=document.createElement('p');p.textContent=note;a.append(l,v,p);return a;}));}
function details(id,items){$(id).replaceChildren(...items.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));}
const viewer=new OrbitViewer($('globe'),id=>{selected=id;$('satellite').value=id;draw();},worldOutline.lines);
// Slider drags fire several input events per frame; draw once per frame instead of once per event.
let drawQueued=0;
function requestDraw(){if(!drawQueued)drawQueued=requestAnimationFrame(()=>{drawQueued=0;draw();});}
function draw(){
  if(drawQueued){cancelAnimationFrame(drawQueued);drawQueued=0;}
  try{
    const states=statesAt(orbits,seconds/60),o=activeObserver(),cfg=scenario.configuration;
    scenario.display.time_sec=seconds;scenario.display.selected_satellite=selected;
    current=evaluateSnapshot(cfg,geometryAt(states,o,seconds/60));
    const leoCount=current.satellites.filter(s=>s.group==='LEO').length,link=current.best?.link,sat=current.satellites.find(s=>s.id===selected);
    cards('snapshot-metrics',[
      ['전체 통신 위성',format(leoCount,0),'기',cfg.mode==='walker'?`${cfg.planes}개 궤도면`:cfg.mode==='multi_shell'?`${cfg.shells.length}개 궤도층`:'TLE 위성군'],
      ['통신 가시 위성',format(current.commVisible,0),'기','기하학적 가시성'],
      ['최선 링크 처리량',format(current.rate,1),'Mbps',`목표 ≥ ${cfg.rateTarget} Mbps`],
      ['링크 마진',format(link?.margin),'dB',current.commPass?'통신 목표 충족':'통신 목표 미충족']
    ]);
    details('comm-snapshot',[
      ['접속 위성',current.best?.id||'없음'],['고도각',format(current.best?.elevation)+'°'],['경사거리',format(current.best?.range,1)+' km'],
      ['편도 지연',format(link?.delayMs)+' ms'],['C/N₀',format(link?.cn0)+' dBHz'],['Eb/N₀',format(link?.ebn0)+' dB']
    ]);
    skyPlot($('sky-plot'),current);text('sky-count',`${current.fusion.satellites}기 사용`);
    details('snapshot-details',[
      ['항법 LEO / GNSS',`${current.navVisibleLEO} / ${current.gnssVisible}`],['지역항법 위성',format(current.regionalVisible,0)+'기'],['GNSS 단독 HRMS',format(current.baseline.hrms)+' m'],['GNSS + LEO HRMS',format(current.gnssLEO.hrms)+' m'],['융합 VRMS',format(current.fusion.vrms)+' m'],['기하학적 PDOP',format(current.fusion.pdop)]
    ]);
    details('link-metrics',[
      ['접속 위성',current.best?.id||'없음'],['고도각',format(current.best?.elevation)+'°'],['경사거리',format(current.best?.range,1)+' km'],['편도 전파지연',format(link?.delayMs)+' ms'],['도플러',format(link?.dopplerKHz)+' kHz'],
      ['링크 마진',format(link?.margin)+' dB'],['C/N',format(link?.snr)+' dB'],['C/N₀',format(link?.cn0)+' dBHz'],['Eb/N₀',format(link?.ebn0)+' dB'],['자유공간 손실',format(link?.fspl)+' dB'],
      ['선택 위성',sat?.id||'없음'],['선택 위성 고도',sat?format(Math.hypot(...sat.position)-6378.137,1)+' km':'—'],['선택 위성 속력 (ECEF)',sat?format(Math.hypot(...sat.velocity),3)+' km/s':'—'],
      ...(domain==='commNav'?[['선택 위성 항법 사용',sat?.navUsed?'사용':'미사용'],['접속 위성 항법 시간',link?format(link.navDuty*100)+'%':'—']]:[])
    ]);
    const edges=scenario.display.isl?islEdges(states):[],cells=[];
    if(scenario.display.heatmap)for(const code of scenario.selection.country_codes){const country=catalog.countries.find(c=>c.code===code),feature=boundaries.features.find(f=>[f.properties.code,f.properties.ADM0_A3,f.properties.ISO_A3,f.properties.adm0_a3].includes(code));cells.push(...coverageGrid(states,country,cfg.commElevation,feature?.geometry));}
    viewer.update(current,orbits,scenario,observers,selected,edges,cells,domain==='commNav');$('time').value=seconds;text('time-label','T + '+hms(seconds));
    renderLegend();
    $('time-back').disabled=seconds<=0;$('time-forward').disabled=seconds>=scenario.analysis.duration_min*60;
    scheduleSave();
    text('route-result','현재 시각의 경로를 계산하세요. 전파지연만 포함하며 Multi-shell은 층 내부 연결입니다.');
  }catch(e){pause();error(e.message);}
}
const viewMeta={
  design:{side:'위성군 구성',eyebrowComm:'COMMUNICATION CONSTELLATION OVERVIEW',eyebrowNav:'COMMUNICATION + NAVIGATION OVERVIEW',titleComm:'통신망 궤도 배치',titleNav:'통신·항법 통합 궤도 배치',descComm:'위성군의 구성과 통신 접속 성능을 확인하세요.',descNav:'위성군의 구성과 통신 접속 성능, 항법 정확도를 함께 확인하세요.',action:'이 구성으로 상세 분석 →',go:'analysis'},
  analysis:{side:'분석 조건',eyebrowComm:'COMMUNICATION NETWORK ANALYSIS',eyebrowNav:'COMMUNICATION + NAVIGATION ANALYSIS',titleComm:'통신망 상세 분석',titleNav:'통신·항법 통합 분석',descComm:'선택한 관측지의 가시성과 통신 처리량을 분석하세요.',descNav:'선택한 관측지의 가시성·통신 처리량·항법 정확도와 동시 목표 충족률을 함께 분석하세요.',action:'궤도 배치 보기 ↗',go:'design'},
  trade:{side:'후보 비교 조건',eyebrowComm:'CONSTELLATION TRADE STUDY',eyebrowNav:'CONSTELLATION TRADE STUDY · COMM + NAV',titleComm:'후보 비교',titleNav:'통신·항법 후보 비교',descComm:'동일한 서비스 조건에서 여섯 개 Walker 후보의 통신 성능을 비교하세요.',descNav:'동일한 서비스 조건에서 여섯 개 Walker 후보의 통신·항법 통합 성능을 비교하세요.',action:'상세 분석 보기 ↗',go:'analysis'}
};
function applyMeta(){
  const meta=viewMeta[view];if(!meta)return;
  const nav=domain==='commNav';
  text('sidebar-title',meta.side);text('workspace-eyebrow',nav?meta.eyebrowNav:meta.eyebrowComm);text('workspace-title',nav?meta.titleNav:meta.titleComm);
  text('workspace-description',nav?meta.descNav:meta.descComm);text('workspace-action',meta.action);$('workspace-action').dataset.go=meta.go;
}
function applyDomainText(){
  text('analysis-empty-note',domain==='commNav'?'도시별 가시율과 통신 목표 충족률을 먼저 확인하고, 항법 성능 확장에서 정확도와 동시 충족률을 함께 비교할 수 있습니다.':'도시별 가시율과 통신 목표 충족률을 확인하세요.');
  text('station-table-note',domain==='commNav'?'선택한 전체 관측지와 분석기간 기준 · 항법 지표도 표에 포함':'선택한 전체 관측지와 분석기간 기준');
  text('map-note','지구 표시는 이미지와 윤곽선 전용 보기로 전환할 수 있습니다. 격자는 국가별 사각 분석 범위(해역 포함)이며 도시 가시율과 구분합니다.');
}
function legendItem(shapeOrLine,color,label){
  const mark=document.createElement('span');mark.className='mark '+(shapeOrLine==='line'?'line':shapeOrLine);mark.style.background=color;
  const item=document.createElement('span');item.className='swatch';item.append(mark,document.createTextNode(label));
  return item;
}
function renderLegend(){
  const shape=scenario.display.satShape,nav=domain==='commNav';
  const items=[
    legendItem(shape,'#53657a','통신 위성'),
    legendItem(shape,'#74b6ff','통신 연결'),
    legendItem(shape,'#ffb55d','최선 접속'),
    legendItem(shape,'#ffffff','선택 위성'),
  ];
  if(nav){
    items.push(legendItem(shape,'#47dacb','항법 겸용 LEO'),legendItem(shape,'#e3ad65','GNSS'),legendItem(shape,'#b4a0ff','지역항법'));
  }
  if(scenario.display.isl)items.push(legendItem('line','#36685f','ISL'));
  if(scenario.display.heatmap)items.push(legendItem('square','hsl(172,70%,55%)','가시 위성 많음'),legendItem('square','#c45259','가시 위성 없음'));
  if(scenario.display.footprint){items.push(legendItem('line','#84e5df','풋프린트'),legendItem('line','#e8db91','지상 궤적'));}
  $('globe-legend').replaceChildren(...items);
}
function setView(next){
  if(!viewMeta[next])return;view=next;document.body.dataset.workspace=next;
  for(const id of ['design','analysis','trade'])$(id).hidden=id!==next;
  for(const b of document.querySelectorAll('[data-tab]')){const active=b.dataset.tab===next;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}
  applyMeta();
  if(next!=='design')pause();if(next==='analysis')renderResults();if(next==='design'){viewer.viewer?.resize();draw();}
  $('workspace').focus({preventScroll:true});
}
function setDomain(next){
  if(!['comm','commNav'].includes(next))return;
  domain=next;scenario.display.domain=next;document.body.dataset.domain=next;
  for(const b of document.querySelectorAll('button[data-domain]')){const active=b.dataset.domain===next;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}
  for(const opt of document.querySelectorAll('#sweep-axis option.nav-only'))opt.hidden=next==='comm';
  if(next==='comm'&&['navShare','payloadPercent'].includes($('sweep-axis').value))$('sweep-axis').value='altitude';
  applyMeta();applyDomainText();draw();renderResults();renderTrade();
}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.tab)));
document.querySelectorAll('button[data-domain]').forEach(b=>b.addEventListener('click',()=>setDomain(b.dataset.domain)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.go)));
$('workspace-action').addEventListener('click',()=>setView($('workspace-action').dataset.go));
modeInput.addEventListener('change',()=>{if(modeInput.value==='multi_shell'&&!$('shells').children.length)addShellRow({id:'SH1',altitude:1280,inclination:42,planes:8,satellitesPerPlane:16,phasing:1,j2:true});modeFields();});
$('configuration').addEventListener('input',()=>{if(sessionReady){sessionDirty=true;text('save-status','입력 중 · 마지막 유효 설정 유지');}clearTimeout(editing);editing=setTimeout(applyInputs,250);});
$('configuration').addEventListener('change',()=>{clearTimeout(editing);applyInputs();});
$('configuration').addEventListener('submit',e=>{e.preventDefault();if(applyInputs())startJob('analyze');});
$('apply-orbit').addEventListener('click',()=>{if(applyInputs()){setView('design');text('status','궤도 배치를 적용했습니다. 지도에서 위성을 선택하거나 시간을 이동해 확인하세요.');}});
$('add-shell').addEventListener('click',()=>{const ids=new Set(readRows('.shell').map(s=>s.id));let n=1;while(ids.has('SH'+n))n++;addShellRow({id:'SH'+n,altitude:600,inclination:70,planes:6,satellitesPerPlane:12,phasing:1,j2:true});applyInputs();});
$('add-observer').addEventListener('click',()=>{const id=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(16).slice(2)}`;addObserverRow({id:'custom:'+id,name:'직접 입력',lat:37,lon:127});applyInputs();});
$('example-tle').addEventListener('click',async()=>{try{$('tle-text').value=await fetch(new URL('./example.tle',import.meta.url)).then(r=>r.text());$('start-utc').value='';applyInputs();}catch(e){error(e.message);}});
$('observer').addEventListener('change',()=>{scenario.active_observer=$('observer').value;refreshConfiguration();const o=activeObserver();viewer.center(o.lon,o.lat);});
$('satellite').addEventListener('change',()=>{selected=$('satellite').value||null;draw();});
function pause(){clearInterval(playing);playing=null;text('play','재생');$('play').setAttribute('aria-pressed','false');}
$('play').addEventListener('click',()=>{if(playing){pause();persistSession();return;}if(seconds>=scenario.analysis.duration_min*60)seconds=0;text('play','일시정지');$('play').setAttribute('aria-pressed','true');playing=setInterval(()=>{const end=scenario.analysis.duration_min*60;seconds=Math.min(end,seconds+Number($('play-speed').value)/2);draw();if(seconds>=end)pause();},500);});
function stepTime(direction){pause();seconds=Math.max(0,Math.min(scenario.analysis.duration_min*60,seconds+direction*scenario.analysis.step_sec));draw();}
$('time-back').addEventListener('click',()=>stepTime(-1));
$('time-forward').addEventListener('click',()=>stepTime(1));
$('time-reset').addEventListener('click',()=>{pause();seconds=0;draw();});
$('time').addEventListener('input',()=>{pause();seconds=Number($('time').value);requestDraw();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();persistSession();}});
window.addEventListener('pagehide',persistSession);
$('recenter').addEventListener('click',()=>{const o=activeObserver();viewer.center(o.lon,o.lat);});
$('zoom-in').addEventListener('click',()=>viewer.zoom(1.25));
$('zoom-out').addEventListener('click',()=>viewer.zoom(1/1.25));
$('map-mode').addEventListener('change',()=>{scenario.display.mode=$('map-mode').value;draw();});
$('earth-style').addEventListener('change',()=>{scenario.display.earthStyle=$('earth-style').value;draw();});
for(const k of ['orbits','isl','heatmap','footprint'])$('show-'+k).addEventListener('change',()=>{scenario.display[k]=$('show-'+k).checked;draw();});
$('sat-shape').addEventListener('change',()=>{scenario.display.satShape=$('sat-shape').value;draw();});
$('sat-size').addEventListener('input',()=>{scenario.display.satSize=Number($('sat-size').value);text('sat-size-value',scenario.display.satSize.toFixed(2)+'×');requestDraw();});
$('orbit-width').addEventListener('input',()=>{scenario.display.orbitWidth=Number($('orbit-width').value);text('orbit-width-value',scenario.display.orbitWidth.toFixed(1)+'×');requestDraw();});
$('route').addEventListener('click',()=>{try{const to=observers.find(o=>o.id===$('route-target').value);if(!to)return;const route=routeBetween(current.satellites,islEdges(current.satellites),activeObserver(),to,scenario.configuration.commElevation);text('route-result',route?`${route.from} → ${route.to} · ${format(route.delayMs)} ms · ISL ${route.hops}홉 · ${route.path.join(' → ')}`:'현재 조건에서 연결 가능한 경로가 없습니다.');}catch(e){error(e.message);}});
$('toggle-settings').addEventListener('click',()=>{const hidden=$('configuration').classList.toggle('collapsed');text('toggle-settings',hidden?'설정 펼치기':'설정 접기');$('toggle-settings').setAttribute('aria-expanded',String(!hidden));});

function finish(message){worker?.terminate();worker=null;$('run').disabled=false;$('run-trade').disabled=scenario.configuration.mode!=='walker';$('cancel').hidden=true;$('progress').hidden=true;text('status',message);}
function startJob(type){if(worker)return;pause();error('');const requestId=++job;
  try{worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});$('run').disabled=true;$('run-trade').disabled=true;$('cancel').hidden=false;$('progress').hidden=false;$('progress').value=0;text('status','분석 중…');setView(type==='trade'?'trade':'analysis');
    worker.onmessage=({data})=>{if(data.requestId!==job)return;if(data.type==='progress'){$('progress').value=data.progress;text('status',`분석 중 · ${data.progress}%`);return;}if(data.type==='error'){finish('계산 실패');error(data.message);return;}if(type==='trade'){tradeResult=data.result;renderTrade();}else{result=data.result;renderResults();}finish('분석 완료');};
    worker.onerror=()=>{finish('계산 실패');error('계산 모듈을 불러오지 못했습니다. 정적 HTTP 주소로 실행했는지 확인하세요.');};
    worker.postMessage({requestId,type,scenario:structuredClone(scenario),catalog});
  }catch(e){finish('계산 실패');error(e.message);}
}
$('cancel').addEventListener('click',()=>{job++;finish('계산을 취소했습니다.');});
$('run-trade').addEventListener('click',()=>{if(applyInputs())startJob('trade');});
function table(id,headers,rows){const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th);}head.append(tr);const body=document.createElement('tbody');for(const values of rows){const row=document.createElement('tr');for(const value of values){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value;row.append(td);}body.append(row);}table.append(head,body);$(id).replaceChildren(table);}
const summaryColumns=[['geometricAvailability','기하 가시율 (%)'],['commAvailability','통신 충족률 (%)'],['navAvailability','항법 충족률 (%)'],['jointAvailability','동시 충족률 (%)'],['validNavAvailability','측위 유효율 (%)'],['avgVisible','평균 가시 위성'],['maxVisible','최대 가시 위성'],['longestOutageSec','최대 기하 단절 (s)'],['longestUnavailableSec','최대 통신 목표 미충족 (s)'],['longestConnectedSec','최장 통신 목표 충족 (s)'],['handovers','기하 핸드오버'],['reconnects','재접속'],['handoversPerHour','기하 핸드오버/h'],['commHandovers','통신 위성 전환'],['medianRate','처리량 중앙값 (Mbps)'],['medianHrms','HRMS 중앙값 (m)'],['medianVrms','VRMS 중앙값 (m)'],['medianPdop','PDOP 중앙값'],['medianMargin','링크 마진 중앙값 (dB)'],['medianDelayMs','편도 지연 중앙값 (ms)']];
const sampleColumns=[['minutes','경과 분'],['commVisible','통신 가시 수'],['geometricBestId','최고 고도각 위성'],['bestId','통신 접속'],['rate','Mbps'],['hrms','HRMS m'],['vrms','VRMS m'],['pdop','PDOP'],['baseline','GNSS HRMS m'],['gnssLEO','GNSS+LEO HRMS m'],['leoVisible','항법 LEO'],['gnssVisible','GNSS'],['regionalVisible','지역항법'],['margin','마진 dB'],['snr','C/N dB'],['cn0','C/N₀ dBHz'],['ebn0','Eb/N₀ dB'],['fspl','FSPL dB'],['delayMs','지연 ms'],['minDelayMs','최소 지연 ms'],['dopplerKHz','도플러 kHz'],['rangeKm','거리 km'],['elevation','고도각 °'],['commPass','통신 충족'],['navPass','항법 충족'],['jointPass','동시 충족']];
const navSummaryKeys=new Set(['navAvailability','jointAvailability','validNavAvailability','medianHrms','medianVrms','medianPdop']);
const navSampleKeys=new Set(['hrms','vrms','pdop','baseline','gnssLEO','leoVisible','gnssVisible','regionalVisible','navPass','jointPass']);
const visibleColumns=(columns,navKeys)=>domain==='commNav'?columns:columns.filter(([k])=>!navKeys.has(k));
function value(v){return typeof v==='boolean'?(v?'충족':'미충족'):typeof v==='string'?v:format(v);}
function renderResults(){if(!result)return;const stale=analysisKey(result.scenario)!==analysisKey(scenario);$('analysis-note').classList.toggle('stale',stale);
  $('analysis-empty').hidden=true;$('analysis-results').hidden=false;
  text('analysis-note',`${stale?'이전 설정의 결과 · 다시 분석해 주세요. ':''}${result.scenario.name} · ${result.scenario.analysis.duration_min}분 / ${result.scenario.analysis.step_sec}초 간격 · 종료 시각 포함 · 시간 가중 비율`);
  const row=result.observers.find(o=>o.observer.id===scenario.active_observer)||result.observers[0],s=row.summary;
  cards('period-metrics',[['기하학적 가시율',format(s.geometricAvailability,1),'%',row.observer.name],['통신 목표 충족률',format(s.commAvailability,1),'%',`≥ ${result.scenario.configuration.rateTarget} Mbps`],['처리량 중앙값',format(s.medianRate,1),'Mbps','유효 표본 기준'],['최장 표본 단절',format(s.longestOutageSec,0),'s','분석 간격 해상도']]);
  cards('nav-period-metrics',[['항법 목표 충족률',format(s.navAvailability,1),'%',`HRMS ≤ ${result.scenario.configuration.horizontalTarget} m`],['동시 목표 충족률',format(s.jointAvailability,1),'%','통신·항법 동시 충족'],['HRMS 중앙값',format(s.medianHrms,2),'m','전체 선택 항법망'],['측위 유효율',format(s.validNavAvailability,1),'%','유효 항법해 표본']]);
  const summaryCols=visibleColumns(summaryColumns,navSummaryKeys);
  table('station-table',['관측지',...summaryCols.map(c=>c[1])],result.observers.map(r=>[r.observer.name,...summaryCols.map(([k])=>format(r.summary[k]))]));
  const points=row.samples.map(s=>({...s,hours:s.minutes/60})),xMax=result.scenario.analysis.duration_min/60;
  lineChart($('rate-chart'),points,[{key:'rate',color:'#f6b75b'}],{xMax,threshold:result.scenario.configuration.rateTarget,yLabel:'Mbps'});
  lineChart($('nav-chart'),points,[{key:'baseline',color:'#899cb5'},{key:'hrms',color:'#47dacb'}],{xMax,threshold:result.scenario.configuration.horizontalTarget,yLabel:'HRMS (m)'});
  table('nav-comparison',['구성','HRMS 중앙값 (m)','목표 충족률 (%)'],[['GNSS 단독',format(s.medianBaseline),format(s.baselineAvailability)],['GNSS + LEO',format(s.medianGnssLEO),format(s.gnssLeoAvailability)],['전체 선택 항법망',format(s.medianHrms),format(s.navAvailability)]]);
  renderContacts();
  const sampleCols=visibleColumns(sampleColumns,navSampleKeys);
  table('sample-table',sampleCols.map(c=>c[1]),row.samples.map(r=>sampleCols.map(([k])=>value(r[k]))));$('export-json').disabled=false;$('export-csv').disabled=false;
}
const contactLabels={'connected':'목표 충족','below-target':'목표 미충족','no-visibility':'가시 위성 없음'};
function selectedResult(){return result?.observers.find(o=>o.observer.id===scenario.active_observer)||result?.observers[0];}
function contactJump(window,label,stale){
  const button=document.createElement('button');button.type='button';button.className='button small';button.textContent=label;
  button.disabled=stale;button.title=stale?'설정이 바뀌었습니다. 다시 분석한 후 이동하세요.':`T + ${hms(window.startSec)} 궤도 배치로 이동`;
  button.addEventListener('click',()=>{pause();seconds=window.startSec;setView('design');});return button;
}
function renderContacts(){
  const row=selectedResult();if(!row)return;const windows=row.contactWindows,stale=analysisKey(result.scenario)!==analysisKey(scenario);
  text('contact-note',`${row.observer.name} · 처리량 ≥ ${result.scenario.configuration.rateTarget} Mbps · ${result.scenario.analysis.step_sec}초 간격${stale?' · 이전 설정 결과 (시각 이동 비활성)':''}`);
  cards('contact-metrics',[
    ['목표 충족 시간',format(row.summary.connectedSec/60,1),'분','전체 분석 기간 합계'],
    ['최장 연속 접속',format(row.summary.longestConnectedSec/60,1),'분','통신 목표 충족 기준'],
    ['최장 목표 미충족',format(row.summary.longestUnavailableSec/60,1),'분','가시 위성 없는 시간 포함']
  ]);
  $('contact-timeline').replaceChildren(...windows.map(w=>{const b=contactJump(w,'',stale);b.className='contact-segment '+w.state;b.style.flexGrow=w.durationSec;b.setAttribute('aria-label',`${contactLabels[w.state]} · ${hms(w.startSec)}부터 ${hms(w.endSec)} · ${format(w.durationSec,1)}초`);b.title=b.getAttribute('aria-label')+(stale?' · 이전 설정 결과':' · 클릭하여 이동');return b;}));
  const filter=$('contact-filter').value,filtered=windows.filter(w=>filter==='all'||(filter==='connected'?w.state==='connected':w.state!=='connected'));
  table('contact-table',['상태','시작 (T+)','종료 (T+)','지속 (초)','평균 Mbps','최저 Mbps','최저 마진 dB','접속 위성'],filtered.map(w=>[contactLabels[w.state],contactJump(w,hms(w.startSec),stale),hms(w.endSec),format(w.durationSec,1),format(w.meanRate),format(w.minRate),format(w.minMargin),w.satellites.join(', ')||'—']));
  if(!filtered.length){const empty=document.createElement('p');empty.className='chart-note';empty.textContent='이 조건에 해당하는 구간이 없습니다.';$('contact-table').append(empty);}
}
$('contact-filter').addEventListener('change',renderContacts);
$('export-contacts').addEventListener('click',()=>{
  const row=selectedResult();if(!row)return;const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const header=['observer_id','observer_name','state','start_sec','end_sec','duration_sec','mean_rate_mbps','min_rate_mbps','min_margin_db','satellites','scenario_json','metadata_json'];
  const rows=row.contactWindows.map(w=>[row.observer.id,row.observer.name,w.state,w.startSec,w.endSec,w.durationSec,w.meanRate,w.minRate,w.minMargin,w.satellites.join('|'),JSON.stringify(result.scenario),JSON.stringify(result.metadata)]);
  download('kleo-contact-windows.csv','\ufeff'+[header,...rows].map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});
function applyCandidate(candidate){
  pause();clearTimeout(editing);job++;if(worker)finish('후보 적용으로 분석을 취소했습니다.');
  const next=structuredClone(tradeResult.scenario);
  Object.assign(next.configuration,{altitude:candidate.altitude,planes:candidate.planes,satellitesPerPlane:16,phasing:next.configuration.phasing%candidate.planes});
  next.display={...scenario.display,time_sec:0,selected_satellite:null};
  try{scenario=validateScenario(next,catalog);seconds=0;selected=null;syncForm();refreshConfiguration();setDomain(scenario.display.domain);setView('design');error('');text('status',`${candidate.altitude.toLocaleString()} km · ${candidate.satellites}기 후보와 비교 당시 분석 조건을 적용했습니다. 상세 분석에서 접속 구간을 확인하세요.`);}catch(e){error(e.message);}
}
function renderTrade(){if(!tradeResult)return;$('export-trade').disabled=false;const stale=analysisKey(tradeResult.scenario)!==analysisKey(scenario);$('trade-note').classList.toggle('stale',stale);text('trade-note',`${stale?'이전 설정의 결과 · ':''}${tradeResult.scenario.analysis.duration_min}분 · 모든 관측지 중 최저 충족률 / 최장 단절 · ${domain==='comm'?'통신':'통신·항법 동시'} 충족률 높은 순, 동률이면 위성 수 적은 순 · 비용 최적화가 아닌 성능 비교`);
  const tradeKeys=domain==='commNav'?['geometric','comm','nav','joint','outage']:['geometric','comm','outage'];
  const tradeHeaders=['고도 km','궤도면','위성 수','기하 가시율 %','통신 %',...(domain==='commNav'?['항법 %','동시 %']:[]),'최장 단절 s','후보 적용'];
  table('trade-table',tradeHeaders,sortTradeCandidates(tradeResult.candidates,domain).map(c=>{const apply=document.createElement('button');apply.type='button';apply.className='button small';apply.textContent='이 후보 적용';apply.setAttribute('aria-label',`${c.altitude} km ${c.satellites}기 후보 적용`);apply.title='비교 당시 관측지·RF·항법·분석 조건을 함께 적용합니다.';apply.addEventListener('click',()=>applyCandidate(c));return [c.altitude,c.planes,c.satellites,...tradeKeys.map(k=>format(c[k])),apply];}));}
$('sweep').addEventListener('click',()=>{if(!applyInputs())return;try{const o=activeObserver(),cfg={...scenario.configuration,location:'custom',latitude:o.lat,longitude:o.lon};const axis=$('sweep-axis').value;
  if(cfg.mode!=='walker'&&!['navShare','payloadPercent'].includes(axis))throw Error('궤도 변수 스윕은 단일 Walker 모드에서 실행합니다.');
  const meta={navShare:[40,'항법 시간 (%)'],payloadPercent:[100,'항법 탑재 (%)'],altitude:[2000,'고도 (km)'],inclination:[90,'경사각 (°)'],planes:[32,'궤도면 수'],satellitesPerPlane:[32,'면당 위성 수']}[axis];
  const points=parameterSweep(cfg,seconds/60,axis);lineChart($('sweep-rate'),points,[{key:'rate',color:'#f6b75b'}],{xMax:meta[0],xKey:axis,xLabel:meta[1],yLabel:'Mbps'});lineChart($('sweep-nav'),points,[{key:'hrms',color:'#47dacb'}],{xMax:meta[0],xKey:axis,xLabel:meta[1],yLabel:'HRMS (m)'});
  text('sweep-note',`T + ${hms(seconds)} · ${o.name} · ${axis==='navShare'?'항법 시간 공유 가정':'현재 신호 구성'} · 순간 성능 (기간 충족률과 구분)`);
}catch(e){error(e.message);}});
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save-scenario').addEventListener('click',()=>{if(applyInputs())download('kleo-scenario-v2.json',JSON.stringify(scenario,null,2),'application/json');});
$('load-scenario').addEventListener('click',()=>$('scenario-file').click());
$('scenario-file').addEventListener('change',async()=>{const file=$('scenario-file').files[0];if(!file)return;try{if(file.size>2_000_000)throw Error('설정 파일은 2 MB 이하만 지원합니다.');const next=importScenario(JSON.parse(await file.text()),catalog);job++;if(worker)finish('새 설정을 불러와 진행 중 분석을 취소했습니다.');scenario=next;seconds=next.display.time_sec;selected=next.display.selected_satellite;syncForm();refreshConfiguration();setDomain(next.display.domain);error('');}catch(e){error('설정 불러오기 실패: '+e.message);}finally{$('scenario-file').value='';}});
$('export-json').addEventListener('click',()=>{if(result)download('kleo-results-v2.json',JSON.stringify(result,null,2),'application/json');});
$('export-trade').addEventListener('click',()=>{if(tradeResult)download('kleo-trade-v2.json',JSON.stringify({...tradeResult,candidates:sortTradeCandidates(tradeResult.candidates,domain),sort_metric:domain==='comm'?'comm':'joint'},null,2),'application/json');});
$('export-csv').addEventListener('click',()=>{if(!result)return;const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const header=['observer_id','observer_name',...sampleColumns.map(c=>c[0]),'scenario_json','metadata_json','observer_summary_json'];const rows=result.observers.flatMap(row=>row.samples.map(s=>[row.observer.id,row.observer.name,...sampleColumns.map(([k])=>s[k]),JSON.stringify(result.scenario),JSON.stringify(result.metadata),JSON.stringify(row.summary)]));download('kleo-results-v2.csv','\ufeff'+[header,...rows].map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');});
$('share').addEventListener('click',async()=>{if(!applyInputs())return;const hash='scenario='+encodeURIComponent(JSON.stringify(scenario));if(hash.length>20000){error('큰 시나리오는 설정 JSON 파일로 공유해 주세요.');return;}const url=new URL(location.href);url.hash=hash;history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url.href);text('status','설정 공유 링크를 복사했습니다.');}catch{text('status','주소창의 링크를 복사해 주세요.');}});
let restoredSession=false;
const params=new URLSearchParams(location.hash.slice(1)),shared=params.get('scenario')??params.get('cfg');
if(shared!==null){
  try{scenario=importScenario(JSON.parse(shared),catalog);text('save-status','공유 설정 · 변경하면 이 기기에 저장됩니다.');}
  catch(e){error('공유 설정을 읽지 못해 기본 설정으로 시작합니다: '+e.message);text('save-status','기존 자동 저장은 유지됩니다.');}
}else{
  try{const saved=loadSession(localStorage,s=>importScenario(s,catalog));if(saved){scenario=saved.scenario;restoredSession=true;text('save-status','이 기기의 마지막 설정을 복원했습니다.');}}
  catch{text('save-status','저장 설정을 읽을 수 없습니다 · 설정 파일을 불러올 수 있습니다.');}
}
seconds=scenario.display.time_sec;selected=scenario.display.selected_satellite;
syncForm();scenario=validateScenario(scenario,catalog);refreshConfiguration();setDomain(scenario.display.domain);
sessionReady=true;
text('status',`준비 완료 · 모델 ${MODEL_VERSION}${restoredSession?' · 마지막 설정 복원 (기간 결과는 재분석)':''}`);
if(matchMedia('(max-width:800px)').matches){$('configuration').classList.add('collapsed');text('toggle-settings','설정 펼치기');}
