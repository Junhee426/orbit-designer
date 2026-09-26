import test from 'node:test';
import assert from 'node:assert/strict';
import {Globe} from '../../standalone/rendering.js';
import {OrbitViewer} from '../../standalone/viewer.js';
import {observerFrame,EARTH_RADIUS} from '../../standalone/engine.js';
import {defaultScenario} from '../../standalone/scenario.js';
import {SATELLITE_FILL,VISIBLE_OUTLINE} from '../../standalone/style.js';

function fixture(t){
  const arcs=[],lines=[],fills=[],paints=[],strokes=[],listeners={};let last=null,path=[],primitive=null,textures=0,frames=0;
  const ctx=new Proxy({
    clearRect(){frames++;arcs.length=lines.length=fills.length=paints.length=strokes.length=0;},
    beginPath(){last=null;path=[];primitive=null;},moveTo(x,y){last=[x,y];path.push(last);},
    lineTo(x,y){if(last)lines.push([last,[x,y]]);last=[x,y];path.push(last);},
    arc(x,y,r){arcs.push({x,y,r});primitive={x,y,r};},
    fill(){if(path.length)fills.push([...path]);paints.push({primitive,path:[...path],color:this.fillStyle,alpha:this.globalAlpha});},
    stroke(){strokes.push({color:this.strokeStyle,alpha:this.globalAlpha});},
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
  return {globe,snapshot,arcs,lines,fills,paints,strokes,listeners,get textures(){return textures;},get frames(){return frames;}};
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
