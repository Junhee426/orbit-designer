const fs=require('fs'),vm=require('vm'),assert=require('assert');
let html=fs.readFileSync('app/static/index.html','utf8');
let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('function startPlayback'));
const testExports='state,startPlayback,stopPlayback,invalidateAnalysis,applyServiceSelection,runAnalysis,saveScenario,loadScenario,exportResultsCSV,csvCell,recordAnalysis';
// Bind real UI functions to a deterministic DOM/network harness, without launching a browser.
code=code.replace('bootstrap();\n})();',`window.testAPI={${testExports}};\n})();`);
function setup(){
  const elements=new Map();let requestImpl=async()=>({ok:true,json:async()=>({})});let timers=[],nextId=1;let captures=[];
  const controls={mode:'walker',dur:'120',step:'60',speed:'1',alt:'1280',inc:'42',planes:'8',spp:'16',phase:'1',j2:'true',minEl:'20',heatRes:'28',citiesPerCountry:'2'};
  const element=id=>{if(!elements.has(id))elements.set(id,{value:controls[id]??'',textContent:'',innerHTML:'',disabled:false,checked:false,max:'7200',style:{},children:[],addEventListener(){},click(){},querySelector(){return null;}});return elements.get(id);};
  const document={getElementById:element,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({click(){}})};
  const context=vm.createContext({window:{},document,console,AbortController,Blob,URL:{createObjectURL:b=>{captures.push(b);return 'blob:test';},revokeObjectURL(){}},setTimeout:(fn,ms)=>{const id=nextId++;timers.push({id,fn,ms});return id;},clearTimeout:id=>{timers=timers.filter(x=>x.id!==id);},Plotly:{purge(){}},fetch:(...args)=>requestImpl(...args)});
  vm.runInContext(code,context);
  return {api:context.window.testAPI,element,setFetch:fn=>{requestImpl=fn;},timers:()=>timers,shift:()=>timers.shift(),captures};
}
(async()=>{
  // 1. An in-flight slow snapshot must not start another playback request.
  let h=setup(),resolve;h.element('timeSlider').value='0';let requests=0;
  h.setFetch(()=>{requests++;return new Promise(r=>{resolve=r;});});
  h.api.startPlayback();const tick=h.shift();const pending=tick.fn();assert.equal(requests,1);assert.equal(h.timers().length,0);
  h.api.stopPlayback();resolve({ok:false,json:async()=>({detail:'test response'})});await pending;assert.equal(h.timers().length,0);
  // 2. Editing clears all previous results and disables exports.
  h=setup();h.api.state.analysis={old:true};h.element('kAvail').textContent='99%';h.api.invalidateAnalysis();assert.equal(h.api.state.analysis,null);assert.equal(h.element('kAvail').textContent,'–');assert(h.element('exportJsonBtn').disabled);
  // 3. Responses from analysis started before an input change must not be published.
  h=setup();let finish;h.setFetch(()=>new Promise(r=>{finish=r;}));const analysis=h.api.runAnalysis();h.api.invalidateAnalysis();finish({ok:true,json:async()=>({coverage_summary:{worst_availability:1},station_timelines:[]})});await analysis;assert.equal(h.api.state.analysis,null);assert.equal(h.element('kAvail').textContent,'–');
  // 4. CSV values cannot start a spreadsheet formula, and quotes are escaped.
  h=setup();assert.equal(h.api.csvCell('=1+1'),'"\'=1+1"');assert.equal(h.api.csvCell('a"b'),'"a""b"');
  // 5. Scenario save includes exact analysis timing and validation schema.
  h=setup();let sent;h.setFetch(async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>sent};});await h.api.saveScenario();assert.equal(sent.schema_version,'kleo.scenario.v1');assert.equal(sent.configuration.altitude_km,1280);assert.equal(sent.duration_min,120);assert.equal(sent.step_sec,60);assert.equal(h.captures.length,1);assert.equal(JSON.parse(await h.captures[0].text()).configuration.mode,'walker');
  // 6. Export carries version, input fingerprint, metrics basis and exact interval.
  h=setup();h.api.state.analysis={analysis_metadata:{app_version:'1.2.0',input_sha256:'abc',inputs:{duration_min:120,step_sec:60}},station_timelines:[{name:'Seoul',availability:.9,lat_deg:37,lon_deg:127,min_elevation_deg:20,avg_visible:2,handovers_per_hour:1,reconnection_count:0,max_sampled_outage_sec:60}]};h.api.exportResultsCSV();const csv=await h.captures[0].text();assert(csv.includes('input_sha256'));assert(csv.includes('left_hold_intervals'));assert(csv.includes('"Seoul"'));assert(csv.includes('"120","60"'));
  // 7. Invalid scenario input must preserve the existing settings.
  h=setup();h.setFetch(async()=>({ok:false,json:async()=>({detail:'Unsupported scenario'})}));await h.api.loadScenario({size:20,text:async()=>'{}'});assert.equal(h.element('alt').value,'1280');assert(h.element('status').textContent.includes('Load failed'));
  console.log('7 frontend behavior checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
