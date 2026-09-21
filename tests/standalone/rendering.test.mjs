import test from 'node:test';
import assert from 'node:assert/strict';
import {Globe} from '../../standalone/rendering.js';
import {OrbitViewer} from '../../standalone/viewer.js';
import {observerFrame,EARTH_RADIUS} from '../../standalone/engine.js';
import {defaultScenario} from '../../standalone/scenario.js';

function fixture(t){
  const arcs=[],lines=[],fills=[],listeners={};let last=null,path=[],textures=0,frames=0;
  const ctx=new Proxy({
    clearRect(){frames++;arcs.length=lines.length=fills.length=0;},
    beginPath(){last=null;path=[];},moveTo(x,y){last=[x,y];path.push(last);},
    lineTo(x,y){if(last)lines.push([last,[x,y]]);last=[x,y];path.push(last);},
    arc(x,y,r){arcs.push({x,y,r});},fill(){if(path.length)fills.push([...path]);},
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
  return {globe,snapshot,arcs,lines,fills,listeners,get textures(){return textures;},get frames(){return frames;}};
}

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
