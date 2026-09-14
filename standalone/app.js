import {DEFAULT_CONFIG,MODEL_VERSION,buildConstellations,statesAt,geometryAt,evaluateSnapshot,parameterSweep} from './engine.js';
import {defaultScenario,validateScenario,importScenario,observersFor,analysisKey} from './scenario.js';
import {skyPlot,lineChart} from './rendering.js';
import {islEdges,routeBetween,coverageGrid} from './geometry.js';
import {OrbitViewer} from './viewer.js';

const $=id=>document.getElementById(id);
const [catalog,boundaries]=await Promise.all([fetch(new URL('./catalog.json',import.meta.url)).then(r=>r.json()),fetch(new URL('./boundaries.geojson',import.meta.url)).then(r=>r.json())]);
let scenario=defaultScenario(),orbits=[],observers=[],current=null,seconds=0,selected=null,worker=null,job=0,playing=null,editing=null,result=null,tradeResult=null,view='design';
let lastOrbitKey='',lastSatKey='';
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
for(const [key,label,type,extra]of [
  ['commElevation','통신 최소 고도각 (°)','number',{min:0,max:90}],['navElevation','항법 최소 고도각 (°)','number',{min:0,max:90}],
  ['leoNav','LEO 항법 탑재체 사용','checkbox',{}],['payloadPercent','항법 탑재 위성 비율 (%)','number',{min:0,max:100}],
  ['regional','지역항법 8기 예시 추가','checkbox',{}],['sharing','신호 구성','select',{options:[['separate','신호 분리'],['time','시간 공유']]}],
  ['navShare','항법 시간 배정 (%)','number',{min:0,max:40}],['horizontalTarget','수평 RMS 목표 (m 이하)','number',{min:.1,max:100}],['rateTarget','통신 목표 (Mbps 이상)','number',{min:1,max:1000}]
])field($('service-fields'),key,label,type,extra);
for(const [key,label,min,max]of [
  ['gnssSigma','GNSS 거리오차 (m)',.1,30],['leoSigma','LEO 잡음 / 1,000 km (m)',.1,30],['orbitSigma','LEO 궤도오차 (m)',0,30],['clockNs','LEO 시계오차 (ns)',0,1000],
  ['eirp','EIRP (dBW)',20,65],['gt','수신 G/T (dB/K)',-10,30],['bandwidth','대역폭 (MHz)',1,500],['frequency','주파수 (GHz)',10,40],['rainLoss','강우손실 (dB)',0,40],['otherLoss','기타손실 (dB)',0,50],['dataRate','마진 기준 데이터율 (Mbps)',.1,10000],['requiredEbn0','요구 Eb/N0 (dB)',-20,40]
])field($('error-fields'),key,label,'number',{min,max});
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
  $('map-mode').value=scenario.display.mode;for(const k of ['orbits','isl','heatmap','footprint'])$('show-'+k).checked=scenario.display[k];
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
function applyInputs(){clearTimeout(editing);try{const next=readForm();scenario=next;refreshConfiguration();error('');return true;}catch(e){error(e.message);return false;}}
function refreshConfiguration(){
  const orbitKey=JSON.stringify(scenario.configuration);if(orbitKey!==lastOrbitKey){orbits=buildConstellations(scenario.configuration);lastOrbitKey=orbitKey;}
  observers=observersFor(scenario,catalog);$('observer').replaceChildren(...observers.map(o=>option(o.id,o.name)));$('observer').value=scenario.active_observer;
  $('route-target').replaceChildren(...observers.filter(o=>o.id!==scenario.active_observer).map(o=>option(o.id,o.name)));$('route').disabled=observers.length<2;
  seconds=Math.min(seconds,scenario.analysis.duration_min*60);$('time').max=scenario.analysis.duration_min*60;
  const cfg=scenario.configuration,total=orbits.filter(o=>o.group==='LEO').length;
  text('orbit-note',`${total.toLocaleString()}기 · ${cfg.mode==='tle'?'SGP4 (J2 중복 적용 없음)':cfg.mode==='multi_shell'?`${cfg.shells.length}개 층 · 층별 J2 설정`:`Walker F=${cfg.phasing} · J2 ${cfg.j2?'켜짐':'꺼짐'}`}`);
  text('map-title',`${total.toLocaleString()}기 · ${cfg.mode==='tle'?'TLE / SGP4':cfg.mode==='multi_shell'?'Multi-shell':cfg.altitude.toLocaleString()+' km'}`);
  const satKey=orbits.map(o=>o.id).join('|');if(satKey!==lastSatKey){$('satellite').replaceChildren(...orbits.filter(o=>o.group==='LEO').map(o=>option(o.id,o.name||o.id)));lastSatKey=satKey;}
  if(!orbits.some(o=>o.id===selected))selected=orbits.find(o=>o.group==='LEO')?.id;$('satellite').value=selected;
  $('run-trade').disabled=!!worker||cfg.mode!=='walker';modeFields();draw();renderResults();renderTrade();
}
function activeObserver(){return observers.find(o=>o.id===scenario.active_observer)||observers[0];}
function cards(id,items){$(id).replaceChildren(...items.map(([label,value,unit='',note=''])=>{const a=document.createElement('article');a.className='metric';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;const u=document.createElement('small');u.textContent=' '+unit;v.append(u);const p=document.createElement('p');p.textContent=note;a.append(l,v,p);return a;}));}
function details(id,items){$(id).replaceChildren(...items.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));}
const viewer=new OrbitViewer($('globe'),id=>{selected=id;$('satellite').value=id;draw();});
text('map-note',$('map-note').textContent+' 격자는 국가별 사각 분석 범위(해역 포함)이며 도시 가시율과 구분합니다.');
function draw(){
  try{
    const states=statesAt(orbits,seconds/60),o=activeObserver(),cfg=scenario.configuration;
    scenario.display.time_sec=seconds;scenario.display.selected_satellite=selected;
    current=evaluateSnapshot(cfg,geometryAt(states,o,seconds/60));
    cards('snapshot-metrics',[
      ['통신 가시 위성',format(current.commVisible,0),'기','기하학적 가시성'],
      ['최선 링크 처리량',format(current.rate,1),'Mbps',`목표 ≥ ${cfg.rateTarget} Mbps`],
      ['융합 항법 수평 RMS',format(current.fusion.hrms),'m',current.fusion.valid?`목표 ≤ ${cfg.horizontalTarget} m`:current.fusion.reason],
      ['현재 동시 목표',current.jointPass?'충족':'미충족','',`통신 ${current.commPass?'✓':'–'} · 항법 ${current.navPass?'✓':'–'}`]
    ]);
    skyPlot($('sky-plot'),current);text('sky-count',`${current.fusion.satellites}기 사용`);
    details('snapshot-details',[
      ['항법 LEO / GNSS',`${current.navVisibleLEO} / ${current.gnssVisible}`],['지역항법 위성',format(current.regionalVisible,0)+'기'],['GNSS 단독 HRMS',format(current.baseline.hrms)+' m'],['GNSS + LEO HRMS',format(current.gnssLEO.hrms)+' m'],['융합 VRMS',format(current.fusion.vrms)+' m'],['기하학적 PDOP',format(current.fusion.pdop)]
    ]);
    const link=current.best?.link,sat=current.satellites.find(s=>s.id===selected);
    details('link-metrics',[
      ['접속 위성',current.best?.id||'없음'],['고도각',format(current.best?.elevation)+'°'],['경사거리',format(current.best?.range,1)+' km'],['편도 전파지연',format(link?.delayMs)+' ms'],['도플러',format(link?.dopplerKHz)+' kHz'],
      ['링크 마진',format(link?.margin)+' dB'],['C/N',format(link?.snr)+' dB'],['C/N₀',format(link?.cn0)+' dBHz'],['Eb/N₀',format(link?.ebn0)+' dB'],['자유공간 손실',format(link?.fspl)+' dB'],
      ['선택 위성',sat?.id||'없음'],['선택 위성 고도',sat?format(Math.hypot(...sat.position)-6378.137,1)+' km':'—'],['선택 위성 속력 (ECEF)',sat?format(Math.hypot(...sat.velocity),3)+' km/s':'—'],['선택 위성 항법 사용',sat?.navUsed?'사용':'미사용'],['접속 위성 항법 시간',link?format(link.navDuty*100)+'%':'—']
    ]);
    const edges=scenario.display.isl?islEdges(states):[],cells=[];
    if(scenario.display.heatmap)for(const code of scenario.selection.country_codes){const country=catalog.countries.find(c=>c.code===code),feature=boundaries.features.find(f=>[f.properties.code,f.properties.ADM0_A3,f.properties.ISO_A3,f.properties.adm0_a3].includes(code));cells.push(...coverageGrid(states,country,cfg.commElevation,feature?.geometry));}
    viewer.update(current,orbits,scenario,observers,selected,edges,cells);$('time').value=seconds;text('time-label','T + '+hms(seconds));
    text('route-result','현재 시각의 경로를 계산하세요. 전파지연만 포함하며 Multi-shell은 층 내부 연결입니다.');
  }catch(e){pause();error(e.message);}
}
function setView(next){view=next;for(const id of ['design','analysis','trade'])$(id).hidden=id!==next;for(const b of document.querySelectorAll('[data-tab]')){b.classList.toggle('active',b.dataset.tab===next);b.setAttribute('aria-current',b.dataset.tab===next?'page':'false');}if(next!=='design')pause();if(next==='analysis')renderResults();if(next==='design'){viewer.viewer?.resize();draw();}}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.tab)));
modeInput.addEventListener('change',()=>{if(modeInput.value==='multi_shell'&&!$('shells').children.length)addShellRow({id:'SH1',altitude:1280,inclination:42,planes:8,satellitesPerPlane:16,phasing:1,j2:true});modeFields();});
$('configuration').addEventListener('input',()=>{clearTimeout(editing);editing=setTimeout(applyInputs,250);});
$('configuration').addEventListener('change',()=>{clearTimeout(editing);applyInputs();});
$('configuration').addEventListener('submit',e=>{e.preventDefault();if(applyInputs())startJob('analyze');});
$('add-shell').addEventListener('click',()=>{const ids=new Set(readRows('.shell').map(s=>s.id));let n=1;while(ids.has('SH'+n))n++;addShellRow({id:'SH'+n,altitude:600,inclination:70,planes:6,satellitesPerPlane:12,phasing:1,j2:true});applyInputs();});
$('add-observer').addEventListener('click',()=>{const id=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(16).slice(2)}`;addObserverRow({id:'custom:'+id,name:'직접 입력',lat:37,lon:127});applyInputs();});
$('example-tle').addEventListener('click',async()=>{try{$('tle-text').value=await fetch(new URL('./example.tle',import.meta.url)).then(r=>r.text());$('start-utc').value='';applyInputs();}catch(e){error(e.message);}});
$('observer').addEventListener('change',()=>{scenario.active_observer=$('observer').value;refreshConfiguration();const o=activeObserver();viewer.center(o.lon,o.lat);});
$('satellite').addEventListener('change',()=>{selected=$('satellite').value;draw();});
function pause(){clearInterval(playing);playing=null;text('play','재생');$('play').setAttribute('aria-pressed','false');}
$('play').addEventListener('click',()=>{if(playing){pause();return;}text('play','일시정지');$('play').setAttribute('aria-pressed','true');playing=setInterval(()=>{const end=scenario.analysis.duration_min*60;seconds=seconds>=end?0:Math.min(end,seconds+60);draw();},500);});
$('time').addEventListener('input',()=>{pause();seconds=Number($('time').value);draw();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
$('recenter').addEventListener('click',()=>{const o=activeObserver();viewer.center(o.lon,o.lat);});
$('map-mode').addEventListener('change',()=>{scenario.display.mode=$('map-mode').value;draw();});
for(const k of ['orbits','isl','heatmap','footprint'])$('show-'+k).addEventListener('change',()=>{scenario.display[k]=$('show-'+k).checked;draw();});
$('route').addEventListener('click',()=>{try{const to=observers.find(o=>o.id===$('route-target').value);if(!to)return;const route=routeBetween(current.satellites,islEdges(current.satellites),activeObserver(),to,scenario.configuration.commElevation);text('route-result',route?`${route.from} → ${route.to} · ${format(route.delayMs)} ms · ISL ${route.hops}홉 · ${route.path.join(' → ')}`:'현재 조건에서 연결 가능한 경로가 없습니다.');}catch(e){error(e.message);}});
$('toggle-settings').addEventListener('click',()=>{const hidden=$('configuration').classList.toggle('collapsed');text('toggle-settings',hidden?'설정 펼치기':'설정 접기');});

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
function table(id,headers,rows){const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th);}head.append(tr);const body=document.createElement('tbody');for(const values of rows){const row=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td);}body.append(row);}table.append(head,body);$(id).replaceChildren(table);}
const summaryColumns=[['geometricAvailability','기하 가시율 (%)'],['commAvailability','통신 충족률 (%)'],['navAvailability','항법 충족률 (%)'],['jointAvailability','동시 충족률 (%)'],['validNavAvailability','측위 유효율 (%)'],['avgVisible','평균 가시 위성'],['maxVisible','최대 가시 위성'],['longestOutageSec','최대 표본 단절 (s)'],['handovers','기하 핸드오버'],['reconnects','재접속'],['handoversPerHour','기하 핸드오버/h'],['commHandovers','통신 위성 전환'],['medianRate','처리량 중앙값 (Mbps)'],['medianHrms','HRMS 중앙값 (m)'],['medianVrms','VRMS 중앙값 (m)'],['medianPdop','PDOP 중앙값'],['medianMargin','링크 마진 중앙값 (dB)'],['medianDelayMs','편도 지연 중앙값 (ms)']];
const sampleColumns=[['minutes','경과 분'],['commVisible','통신 가시 수'],['geometricBestId','최고 고도각 위성'],['bestId','통신 접속'],['rate','Mbps'],['hrms','HRMS m'],['vrms','VRMS m'],['pdop','PDOP'],['baseline','GNSS HRMS m'],['gnssLEO','GNSS+LEO HRMS m'],['leoVisible','항법 LEO'],['gnssVisible','GNSS'],['regionalVisible','지역항법'],['margin','마진 dB'],['snr','C/N dB'],['cn0','C/N₀ dBHz'],['ebn0','Eb/N₀ dB'],['fspl','FSPL dB'],['delayMs','지연 ms'],['minDelayMs','최소 지연 ms'],['dopplerKHz','도플러 kHz'],['rangeKm','거리 km'],['elevation','고도각 °'],['commPass','통신 충족'],['navPass','항법 충족'],['jointPass','동시 충족']];
function value(v){return typeof v==='boolean'?(v?'충족':'미충족'):typeof v==='string'?v:format(v);}
function renderResults(){if(!result)return;const stale=analysisKey(result.scenario)!==analysisKey(scenario);$('analysis-note').classList.toggle('stale',stale);
  text('analysis-note',`${stale?'이전 설정의 결과 · 다시 분석해 주세요. ':''}${result.scenario.name} · ${result.scenario.analysis.duration_min}분 / ${result.scenario.analysis.step_sec}초 간격 · 종료 시각 포함 · 시간 가중 비율`);
  const row=result.observers.find(o=>o.observer.id===scenario.active_observer)||result.observers[0],s=row.summary;
  cards('period-metrics',[['기하학적 가시율',format(s.geometricAvailability,1),'%',row.observer.name],['통신 목표 충족률',format(s.commAvailability,1),'%',`≥ ${result.scenario.configuration.rateTarget} Mbps`],['항법 목표 충족률',format(s.navAvailability,1),'%',`HRMS ≤ ${result.scenario.configuration.horizontalTarget} m`],['동시 목표 충족률',format(s.jointAvailability,1),'%','같은 시간에 두 목표 충족']]);
  table('station-table',['관측지',...summaryColumns.map(c=>c[1])],result.observers.map(r=>[r.observer.name,...summaryColumns.map(([k])=>format(r.summary[k]))]));
  const points=row.samples.map(s=>({...s,hours:s.minutes/60})),xMax=result.scenario.analysis.duration_min/60;
  lineChart($('rate-chart'),points,[{key:'rate',color:'#f6b75b'}],{xMax,threshold:result.scenario.configuration.rateTarget,yLabel:'Mbps'});
  lineChart($('nav-chart'),points,[{key:'baseline',color:'#899cb5'},{key:'hrms',color:'#47dacb'}],{xMax,threshold:result.scenario.configuration.horizontalTarget,yLabel:'HRMS (m)'});
  table('nav-comparison',['구성','HRMS 중앙값 (m)','목표 충족률 (%)'],[['GNSS 단독',format(s.medianBaseline),format(s.baselineAvailability)],['GNSS + LEO',format(s.medianGnssLEO),format(s.gnssLeoAvailability)],['전체 선택 항법망',format(s.medianHrms),format(s.navAvailability)]]);
  table('sample-table',sampleColumns.map(c=>c[1]),row.samples.map(r=>sampleColumns.map(([k])=>value(r[k]))));$('export-json').disabled=false;$('export-csv').disabled=false;
}
function renderTrade(){if(!tradeResult)return;$('export-trade').disabled=false;const stale=analysisKey(tradeResult.scenario)!==analysisKey(scenario);$('trade-note').classList.toggle('stale',stale);text('trade-note',`${stale?'이전 설정의 결과 · ':''}${tradeResult.scenario.analysis.duration_min}분 · 모든 관측지 중 최저 충족률 / 최장 단절 · 비용 최적화가 아닌 성능 비교`);table('trade-table',['고도 km','궤도면','위성 수','기하 가시율 %','통신 %','항법 %','동시 %','최장 단절 s'],tradeResult.candidates.map(c=>[c.altitude,c.planes,c.satellites,...['geometric','comm','nav','joint','outage'].map(k=>format(c[k]))]));}
$('sweep').addEventListener('click',()=>{if(!applyInputs())return;try{const o=activeObserver(),cfg={...scenario.configuration,location:'custom',latitude:o.lat,longitude:o.lon};const axis=$('sweep-axis').value;
  if(cfg.mode!=='walker'&&!['navShare','payloadPercent'].includes(axis))throw Error('궤도 변수 스윕은 단일 Walker 모드에서 실행합니다.');
  const meta={navShare:[40,'항법 시간 (%)'],payloadPercent:[100,'항법 탑재 (%)'],altitude:[2000,'고도 (km)'],inclination:[90,'경사각 (°)'],planes:[32,'궤도면 수'],satellitesPerPlane:[32,'면당 위성 수']}[axis];
  const points=parameterSweep(cfg,seconds/60,axis);lineChart($('sweep-rate'),points,[{key:'rate',color:'#f6b75b'}],{xMax:meta[0],xKey:axis,xLabel:meta[1],yLabel:'Mbps'});lineChart($('sweep-nav'),points,[{key:'hrms',color:'#47dacb'}],{xMax:meta[0],xKey:axis,xLabel:meta[1],yLabel:'HRMS (m)'});
  text('sweep-note',`T + ${hms(seconds)} · ${o.name} · ${axis==='navShare'?'항법 시간 공유 가정':'현재 신호 구성'} · 순간 성능 (기간 충족률과 구분)`);
}catch(e){error(e.message);}});
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save-scenario').addEventListener('click',()=>{if(applyInputs())download('kleo-scenario-v2.json',JSON.stringify(scenario,null,2),'application/json');});
$('load-scenario').addEventListener('click',()=>$('scenario-file').click());
$('scenario-file').addEventListener('change',async()=>{const file=$('scenario-file').files[0];if(!file)return;try{if(file.size>2_000_000)throw Error('설정 파일은 2 MB 이하만 지원합니다.');const next=importScenario(JSON.parse(await file.text()),catalog);job++;if(worker)finish('새 설정을 불러와 진행 중 분석을 취소했습니다.');scenario=next;seconds=next.display.time_sec;selected=next.display.selected_satellite;syncForm();refreshConfiguration();error('');}catch(e){error('설정 불러오기 실패: '+e.message);}finally{$('scenario-file').value='';}});
$('export-json').addEventListener('click',()=>{if(result)download('kleo-results-v2.json',JSON.stringify(result,null,2),'application/json');});
$('export-trade').addEventListener('click',()=>{if(tradeResult)download('kleo-trade-v2.json',JSON.stringify(tradeResult,null,2),'application/json');});
$('export-csv').addEventListener('click',()=>{if(!result)return;const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const header=['observer_id','observer_name',...sampleColumns.map(c=>c[0]),'scenario_json','metadata_json','observer_summary_json'];const rows=result.observers.flatMap(row=>row.samples.map(s=>[row.observer.id,row.observer.name,...sampleColumns.map(([k])=>s[k]),JSON.stringify(result.scenario),JSON.stringify(result.metadata),JSON.stringify(row.summary)]));download('kleo-results-v2.csv','\ufeff'+[header,...rows].map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');});
$('share').addEventListener('click',async()=>{if(!applyInputs())return;const hash='scenario='+encodeURIComponent(JSON.stringify(scenario));if(hash.length>20000){error('큰 시나리오는 설정 JSON 파일로 공유해 주세요.');return;}const url=new URL(location.href);url.hash=hash;history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url.href);text('status','설정 공유 링크를 복사했습니다.');}catch{text('status','주소창의 링크를 복사해 주세요.');}});
try{const params=new URLSearchParams(location.hash.slice(1)),shared=params.get('scenario')??params.get('cfg');if(shared){scenario=importScenario(JSON.parse(shared),catalog);seconds=scenario.display.time_sec;selected=scenario.display.selected_satellite;}}catch(e){error('공유 설정을 읽지 못해 기본 설정으로 시작합니다: '+e.message);}
syncForm();scenario=validateScenario(scenario,catalog);refreshConfiguration();
text('status',`준비 완료 · 모델 ${MODEL_VERSION}`);
if(matchMedia('(max-width:800px)').matches){$('configuration').classList.add('collapsed');text('toggle-settings','설정 펼치기');}
