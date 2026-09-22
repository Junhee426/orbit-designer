import {buildConstellations,statesAt,sampleAt,observerFrame,quantile} from './engine.js';
import {sampleTimes,observersFor,validateScenario,metadata} from './scenario.js';

export function sortTradeCandidates(candidates,domain) {
  const metric=domain==='comm'?'comm':'joint';
  return [...candidates].sort((a,b)=>b[metric]-a[metric]||a.satellites-b.satellites||a.altitude-b.altitude);
}

export function intervalSummary(samples,config) {
  if(samples.length<2) throw Error('종료 시각을 포함한 두 표본 이상이 필요합니다.');
  const dt=samples.slice(1).map((s,i)=>(s.minutes-samples[i].minutes)*60);
  if(dt.some(x=>!Number.isFinite(x)||x<=0)) throw Error('시간 표본은 증가해야 합니다.');
  const duration=dt.reduce((a,b)=>a+b,0),body=samples.slice(0,-1);
  const ratio=fn=>100*body.reduce((sum,s,i)=>sum+(fn(s)?dt[i]:0),0)/duration;
  let gap=0,longest=0,handovers=0,reconnects=0,commHandovers=0,previous=null,previousComm=null,seen=false;
  for(const [i,s] of samples.entries()) {
    if(s.geometricBestId) {if(previous&&previous!==s.geometricBestId)handovers++;else if(!previous&&seen)reconnects++;previous=s.geometricBestId;seen=true;} else previous=null;
    if(previousComm&&s.bestId&&previousComm!==s.bestId)commHandovers++;previousComm=s.bestId;
    if(i<dt.length) {gap=s.commVisible>0?0:gap+dt[i];longest=Math.max(longest,gap);}
  }
  const median=key=>quantile(body.map(s=>s[key]),.5);
  return {durationSec:duration,samples:samples.length,geometricAvailability:ratio(s=>s.commVisible>0),
    commAvailability:ratio(s=>s.commPass),navAvailability:ratio(s=>s.navPass),jointAvailability:ratio(s=>s.jointPass),
    validNavAvailability:ratio(s=>Number.isFinite(s.hrms)),baselineAvailability:ratio(s=>Number.isFinite(s.baseline)&&s.baseline<=config.horizontalTarget),
    gnssLeoAvailability:ratio(s=>Number.isFinite(s.gnssLEO)&&s.gnssLEO<=config.horizontalTarget),
    avgVisible:body.reduce((sum,s,i)=>sum+s.commVisible*dt[i],0)/duration,maxVisible:Math.max(...samples.map(s=>s.commVisible)),
    longestOutageSec:longest,handovers,reconnects,handoversPerHour:handovers*3600/duration,commHandovers,
    medianRate:median('rate'),medianHrms:median('hrms'),medianVrms:median('vrms'),medianPdop:median('pdop'),medianBaseline:median('baseline'),medianGnssLEO:median('gnssLEO'),
    medianMargin:median('margin'),medianDelayMs:median('delayMs'),maxSampleIntervalSec:Math.max(...dt)};
}
export async function analyze(input,catalog,progress=()=>{}) {
  const scenario=validateScenario(input,catalog),cfg=scenario.configuration;
  const observers=observersFor(scenario,catalog),orbits=buildConstellations(cfg),times=sampleTimes(scenario.analysis.duration_min,scenario.analysis.step_sec);
  const rows=observers.map(observer=>({observer,samples:[]})),frames=observers.map(o=>observerFrame(o.lat,o.lon));
  // Yield by elapsed time, not sample count: each setTimeout costs a clamped timer tick (≥4 ms in
  // browsers), which used to exceed the computation itself for small constellations.
  let yielded=performance.now();
  for(let i=0;i<times.length;i++) {
    const minutes=times[i]/60,states=statesAt(orbits,minutes);
    rows.forEach((row,k)=>row.samples.push(sampleAt(cfg,states,row.observer,minutes,frames[k])));
    if(i===0||performance.now()-yielded>=100) {progress(Math.round(i/times.length*100));await new Promise(r=>setTimeout(r,0));yielded=performance.now();}
  }
  for(const row of rows) row.summary=intervalSummary(row.samples,cfg);
  return {scenario,observers:rows,metadata:await metadata(scenario),totalSatellites:orbits.filter(o=>o.group==='LEO').length};
}
export async function tradeStudy(input,catalog,progress=()=>{}) {
  const scenario=validateScenario(input,catalog);
  if(scenario.configuration.mode!=='walker') throw Error('고도·위성 수 후보 비교는 단일 Walker 모드에서 실행합니다.');
  const result=[];let index=0;
  for(const altitude of [500,888,1280])for(const planes of [8,16]) {
    const candidate=structuredClone(scenario);Object.assign(candidate.configuration,{altitude,planes,satellitesPerPlane:16,phasing:scenario.configuration.phasing%planes});
    const analysis=await analyze(candidate,catalog,p=>progress(Math.round((index+p/100)/6*100)));
    const sums=analysis.observers.map(o=>o.summary);
    result.push({altitude,planes,satellites:planes*16,geometric:Math.min(...sums.map(s=>s.geometricAvailability)),comm:Math.min(...sums.map(s=>s.commAvailability)),nav:Math.min(...sums.map(s=>s.navAvailability)),joint:Math.min(...sums.map(s=>s.jointAvailability)),outage:Math.max(...sums.map(s=>s.longestOutageSec))});index++;
  }
  return {scenario,candidates:sortTradeCandidates(result,scenario.display.domain),metadata:await metadata(scenario)};
}
