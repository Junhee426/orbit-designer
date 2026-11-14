import test from 'node:test';
import assert from 'node:assert/strict';
import {Globe} from '../../standalone/rendering.js';
import {OrbitViewer} from '../../standalone/viewer.js';
import {observerFrame,EARTH_RADIUS,buildConstellations,orbitState} from '../../standalone/engine.js';
import {defaultScenario} from '../../standalone/scenario.js';
import {SATELLITE_FILL,VISIBLE_OUTLINE,ORBIT_LINE,SELECTED_ORBIT_LINE,GROUND_TRACK_LINE} from '../../standalone/style.js';

function fixture(t){
  const arcs=[],lines=[],fills=[],paints=[],strokes=[],operations=[],listeners={};let last=null,path=[],primitive=null,textures=0,frames=0;
  const ctx=new Proxy({
    clearRect(){frames++;arcs.length=lines.length=fills.length=paints.length=strokes.length=operations.length=0;},
    beginPath(){last=null;path=[];primitive=null;},moveTo(x,y){last=[x,y];path.push(last);},
    lineTo(x,y){if(last)lines.push([last,[x,y]]);last=[x,y];path.push(last);},
    arc(x,y,r){arcs.push({x,y,r});primitive={x,y,r};},
    fill(){if(path.length)fills.push([...path]);paints.push({primitive,path:[...path],color:this.fillStyle,alpha:this.globalAlpha});},
    stroke(){strokes.push({color:this.strokeStyle,alpha:this.globalAlpha});operations.push({type:'stroke',color:this.strokeStyle});},
    drawImage(...args){operations.push({type:'image',args});},
    fillText(text,x,y){operations.push({type:'label',text,x,y,color:this.fillStyle});},
    createRadialGradient(){return {addColorStop(){}};},
    createImageData(w,h){textures++;return {data:new Uint8ClampedArray(w*h*4)};}
  },{get:(obj,key)=>key in obj?obj[key]:()=>{}});
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:600,height:400}),
    addEventListener:(name,fn)=>listeners[name]=fn,setPointerCapture(){}};
  for(const [key,value]of Object.entries({Image:class{},ResizeObserver:class{observe(){}},window:{devicePixelRatio:1},document:{createElement:()=>({getContext:()=>ctx})},requestAnimationFrame:fn=>{fn();return 1;}})){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
    t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
  }
  const globe=new Globe(canvas);
  const snapshot={minutes:0,satellites:[],observer:observerFrame(37.5,179.9).position,location:{name:'Site'}};
  globe.set(snapshot,[]);
  return {globe,snapshot,arcs,lines,fills,paints,strokes,operations,listeners,get textures(){return textures;},get frames(){return frames;}};
}

test('canvas satellites have equal size and opacity; visible outlines track the domain and toggle',t=>{
  const f=fixture(t),g=f.globe;g.setMode('map');g.setFull(true);g.setLayers(false,false,false,false,20);
  const satellites=[
    {id:'visible',group:'LEO',position:[7378,0,0],link:{}},
    {id:'other',group:'LEO',position:[0,7378,0]},
    {id:'nav',group:'GNSS',position:[0,-20000,0],navUsed:true},
    {id:'selected',group:'LEO',position:[-7378,0,0]}
  ];
  const snapshot={...f.snapshot,satellites,best:satellites[0]};
  const markers=()=>f.paints.filter(p=>p.color===SATELLITE_FILL);
  const outlines=()=>f.strokes.filter(s=>s.color===VISIBLE_OUTLINE);
  g.set(snapshot,[],'selected');
  assert.equal(markers().length,4);
  assert.ok(markers().every(p=>p.primitive.r===4&&p.alpha===1));
  assert.equal(outlines().length,2);
  g.highlightVisible=false;g.draw();
  assert.equal(outlines().length,0);assert.ok(markers().every(p=>p.primitive.r===4&&p.alpha===1));
  g.highlightVisible=true;g.setFull(false);
  assert.equal(markers().length,3);assert.equal(outlines().length,1);
  g.setStyle('circle',2,1);assert.ok(markers().every(p=>p.primitive.r===8&&p.alpha===1));
  // Front-facing ordinary LEO markers used to be faded only in the globe view.
  satellites.forEach(s=>s.position=observerFrame(25,120).position.map(v=>v*1.2));
  g.setFull(true);g.setMode('globe');
  assert.equal(markers().length,4);assert.ok(markers().every(p=>p.primitive.r===8&&p.alpha===1));
});

test('flat map centers an observer after zooming and supports dragging',t=>{
  const f=fixture(t),g=f.globe;g.setMode('map');g.zoom(2);g.center(37.5,179.9);
  const marker=f.arcs.at(-1);assert.ok(Math.abs(marker.x-300)<1e-7);assert.ok(Math.abs(marker.y-200)<1e-7);
  f.listeners.pointerdown({clientX:100,clientY:100,pointerId:1});
  f.listeners.pointermove({clientX:120,clientY:110});
  assert.notEqual(g.mapCenter.lon,179.9);
  assert.ok(Math.abs(f.arcs.at(-1).x-320)<1e-7);
  assert.ok(Math.abs(f.arcs.at(-1).y-210)<1e-7);
  g.center(-80,-179.9);g.snapshot.observer=observerFrame(-80,-179.9).position;g.draw();
  assert.ok(Math.abs(f.arcs.at(-1).x-300)<1e-7);assert.ok(Math.abs(f.arcs.at(-1).y-200)<1e-7);
});

test('map seams do not create cross-world lines or heatmap polygons',t=>{
  const f=fixture(t),g=f.globe;g.setMode('map');g.center(0,180);
  g.worldLines=[[[0,-1],[0,1],[0,2]]];
  g.setLayers(false,false,true,false,20);
  g.set(f.snapshot,[],null,[],[{south:-1,north:1,west:-1,east:1,count:1}]);
  assert.ok(f.lines.length>0);
  assert.ok(f.lines.every(([a,b])=>Math.abs(a[0]-b[0])<=564/2));
  assert.equal(f.fills.length,3);
  assert.ok(f.fills.every(p=>Math.max(...p.map(v=>v[0]))-Math.min(...p.map(v=>v[0]))<4));
});

test('viewer reuses globe texture and draws once per update, including style changes',t=>{
  const f=fixture(t),g=f.globe;
  const viewer=Object.create(OrbitViewer.prototype);
  Object.assign(viewer,{fallback:g,canvas:{},container:{dataset:{}},uiMode:'2d-globe',viewer:null});
  const s=defaultScenario();s.display.mode='2d-globe';
  const frames=f.frames,textures=f.textures;
  for(let i=0;i<120;i++){
    s.display.satSize=i===119?2:1;
    viewer.update({...f.snapshot,minutes:i},[],s,[],null,[],[],false);
  }
  assert.equal(f.frames-frames,120);
  assert.equal(f.textures,textures);
  g.center(10,20);assert.equal(f.textures,textures+1);
  const before=f.textures;
  const sat={id:'G1',group:'GNSS',position:[EARTH_RADIUS*4,0,0]};
  viewer.update({...f.snapshot,satellites:[sat]},[],s,[],null,[],[],true);
  assert.equal(f.textures,before+1,'changed globe scale needs a new texture resolution');
});

test('service target visibility hides canvas markers and names without changing satellites or links',t=>{
  const f=fixture(t),g=f.globe,viewer=Object.create(OrbitViewer.prototype),s=defaultScenario();
  Object.assign(viewer,{fallback:g,canvas:{},container:{dataset:{}},uiMode:'2d-globe',viewer:null});
  g.center(37.5,179.9);
  const sat={id:'LEO1',group:'LEO',position:f.snapshot.observer.map(v=>v*1.2)};
  const snapshot={...f.snapshot,satellites:[sat],best:sat};
  const labels=()=>f.operations.filter(o=>o.type==='label'&&o.text==='Site');
  const markers=()=>f.paints.filter(p=>p.color==='#fff');
  for(const mode of ['2d-map','2d-globe']){
    s.display.mode=mode;s.display.serviceAreas=true;
    viewer.update(snapshot,[],s,[],sat.id);
    assert.equal(labels().length,1);assert.equal(markers().length,1);
    const visibleLines=f.lines.length;
    s.display.serviceAreas=false;viewer.update(snapshot,[],s,[],sat.id);
    assert.equal(labels().length,0);assert.equal(markers().length,0);
    assert.equal(f.paints.filter(p=>p.color===SATELLITE_FILL).length,1);
    assert.equal(f.lines.length,visibleLines,'independent link and footprint overlays remain visible');
    s.display.serviceAreas=true;viewer.update(snapshot,[],s,[],sat.id);
    assert.equal(labels().length,1);assert.equal(markers().length,1);
  }
});

test('front-facing orbit arcs render above the globe and selection respects orbit and domain visibility',t=>{
  const f=fixture(t),g=f.globe,orbit=buildConstellations(defaultScenario().configuration)[0];
  const satellite={...orbit,...orbitState(orbit,0)};
  g.center(0,0);g.setLayers(true,false,false,false,20);
  g.set({...f.snapshot,satellites:[satellite]},[orbit],satellite.id);
  const surface=f.operations.findIndex(o=>o.type==='image');
  const orbitalArc=f.operations.findIndex(o=>o.type==='stroke'&&o.color===ORBIT_LINE);
  assert.ok(surface>=0&&orbitalArc>surface,'visible orbit paths must not be painted over by the Earth texture');
  assert.ok(f.strokes.some(s=>s.color===SELECTED_ORBIT_LINE));
  assert.ok(f.operations.some(o=>o.type==='label'&&o.text===satellite.id&&o.color===SELECTED_ORBIT_LINE));
  assert.ok(f.paints.filter(p=>p.color===SATELLITE_FILL).every(p=>p.primitive.r===4&&p.alpha===1));
  g.showSatelliteLabels=false;g.draw();
  assert.ok(f.operations.every(o=>o.type!=='label'||o.text!==satellite.id));
  assert.ok(f.strokes.some(s=>s.color===SELECTED_ORBIT_LINE),'hiding labels keeps the selected orbital path');
  assert.ok(f.strokes.some(s=>s.color===GROUND_TRACK_LINE),'hiding labels keeps the selected ground track');
  g.showSatelliteLabels=true;g.draw();
  assert.ok(f.operations.some(o=>o.type==='label'&&o.text===satellite.id));
  g.set({...f.snapshot,satellites:[satellite],best:satellite},[orbit],null);
  assert.ok(f.operations.every(o=>o.type!=='label'||o.text!==satellite.id),'no selection must not label the best-link satellite automatically');
  assert.ok(f.strokes.every(s=>s.color!==SELECTED_ORBIT_LINE&&s.color!==GROUND_TRACK_LINE));
  g.set({...f.snapshot,satellites:[satellite]},[orbit],satellite.id);
  g.setLayers(false,false,false,false,20);g.draw();
  assert.ok(f.strokes.every(s=>s.color!==ORBIT_LINE&&s.color!==SELECTED_ORBIT_LINE),'orbit toggle hides both base and selected orbital paths');
  const hidden={...satellite,id:'G01',group:'GNSS'};
  g.set({...f.snapshot,satellites:[hidden]},[{...orbit,id:'G01',group:'GNSS'}],'G01');
  assert.ok(f.strokes.every(s=>s.color!==GROUND_TRACK_LINE),'a hidden navigation satellite must not leave its selected surface track visible');
});

test('flat image map tiles the local Earth texture across a shifted longitude seam',t=>{
  const f=fixture(t),g=f.globe,image={name:'offline-earth'};
  g.texture={canvas:image};g.setMode('map');g.center(0,170);
  const tiles=f.operations.filter(o=>o.type==='image');
  assert.equal(tiles.length,3);
  assert.ok(tiles.every(tile=>tile.args[0]===image));
  const central=tiles[1].args,wrapped=tiles[2].args;
  assert.equal(wrapped[1]-central[1],564,'adjacent texture copies share an exact antimeridian edge');
  assert.ok(central[1]<=300&&central[1]+central[3]>=300,'the centered longitude remains covered by the texture');
  g.setEarthStyle('outline');
  assert.ok(f.operations.every(o=>o.type!=='image'),'outline mode keeps the image layer hidden');
});
