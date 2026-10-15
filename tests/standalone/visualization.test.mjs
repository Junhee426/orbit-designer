import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineChartModel, nearestSampleIndex, elapsedTime, lineChart, tradeChart} from '../../standalone/visualization.js';

// Minimal DOM exercises actual SVG output and event handlers without adding a dependency.
function fixture(width = 640) {
  class Element {
    constructor(tag, doc) {this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.style={};this.listeners={};this.hidden=false;this.content='';}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children=[...children];this.content='';}
    setAttribute(key, value) {this.attributes[key]=String(value);}
    getAttribute(key) {return this.attributes[key] ?? null;}
    removeAttribute(key) {delete this.attributes[key];}
    addEventListener(type, listener) {this.listeners[type]=listener;}
    getBoundingClientRect() {return {width,height:294,left:0,top:0};}
    get textContent() {return this.content+this.children.map(child=>child.textContent).join('');}
    set textContent(value) {this.content=String(value);this.children=[];}
    focus() {this.emit('focus');}
    emit(type, props={}) {let prevented=false;this.listeners[type]?.({...props,preventDefault(){prevented=true;}});return prevented;}
  }
  const doc={createElement:tag=>new Element(tag,doc),createElementNS:(_,tag)=>new Element(tag,doc),createTextNode:text=>({textContent:text})};
  const container=doc.createElement('div');
  const all=(root=container)=>[root,...(root.children||[]).flatMap(child=>all(child))];
  return {container,all,byClass:className=>all().filter(node=>(node.className||node.attributes?.class||'').split(' ').includes(className))};
}

test('line model sorts real sample times, keeps gaps, and includes negative values and goals in its domain',()=>{
  const points=[{hours:1,rate:20},{hours:0,rate:-5},{hours:NaN,rate:9999},{hours:.4,rate:null},{hours:.8,rate:0}];
  const model=createLineChartModel(points,[{key:'rate',color:'orange'}],{xMax:1,threshold:50});
  assert.deepEqual(model.rows.map(row=>row.x),[0,.4,.8,1]);
  assert.deepEqual(model.series[0].runs.map(run=>run.map(point=>point.y)),[[-5],[0,20]]);
  assert.ok(model.yDomain.min<=-5 && model.yDomain.max>=50);
  assert.equal(nearestSampleIndex(model.rows,.6),1,'ties select the earlier actual sample');
  assert.equal(nearestSampleIndex(model.rows,.73),2);
  assert.equal(nearestSampleIndex(model.rows,-100),0);
  assert.equal(nearestSampleIndex(model.rows,99),3);
  assert.equal(nearestSampleIndex([],0),-1);
  assert.equal(points[0].hours,1,'source points are not reordered');
});

test('zero duration, zero throughput, isolated points, and unavailable series produce finite chart geometry',()=>{
  for (const points of [[],[{hours:0,rate:0}],[{hours:0,rate:null}],[{hours:0,rate:4},{hours:.5,rate:NaN},{hours:1,rate:3}]]) {
    const f=fixture(320),{model}=lineChart(f.container,points,[{key:'rate',color:'#f6b75b'}],{xMax:0,yLabel:'Mbps',threshold:0});
    assert.ok(model.xMax>model.xMin);
    for (const element of f.all()) for (const value of Object.values(element.attributes||{})) assert.doesNotMatch(value,/NaN|Infinity/);
    assert.ok(f.byClass('chart-legend').length===1);
    if (points.length===1 && points[0].rate===0) assert.equal(f.all().filter(node=>node.attributes?.['data-single-sample']==='rate').length,1);
    if (!model.hasValues) assert.match(f.container.textContent,/유효한 성능 표본이 없습니다/);
  }
});

test('chart keyboard and pointer inspection use accurate uneven sample times and preserve missing values',()=>{
  const f=fixture(),points=[{hours:0,rate:0},{hours:1/60,rate:2.375},{hours:.25,rate:null}];
  const {svg}=lineChart(f.container,points,[{key:'rate',color:'#f6b75b',label:'통신 처리량'}],{xMax:1,yLabel:'Mbps'});
  const tooltip=f.byClass('chart-tooltip')[0];
  svg.emit('focus');assert.equal(svg.getAttribute('data-active-sample'),'0');assert.match(tooltip.textContent,/T \+ 00:00:00.*0 Mbps/);
  assert.ok(svg.emit('keydown',{key:'ArrowRight'}));assert.equal(svg.getAttribute('data-active-sample'),'1');
  assert.match(tooltip.textContent,/T \+ 00:01:00.*2\.375 Mbps/);
  svg.emit('keydown',{key:'End'});assert.match(tooltip.textContent,/00:15:00.*유효 표본 없음/);
  svg.emit('keydown',{key:'Escape'});assert.equal(tooltip.hidden,true);
  svg.emit('pointermove',{clientX:58+(640-58-24)*.02});assert.equal(svg.getAttribute('data-active-sample'),'1');
  svg.emit('blur');assert.equal(tooltip.hidden,true);
  assert.equal(elapsedTime(25.5),'T + 25:30:00','hours are not wrapped at midnight');
  assert.equal(elapsedTime(NaN),'—');
});

test('chart model handles a full day of one-second two-series samples without argument-stack limits',()=>{
  const points=Array.from({length:86401},(_,i)=>({hours:i/3600,rate:i%200,hrms:10-i%11}));
  const model=createLineChartModel(points,[{key:'rate'},{key:'hrms'}],{xMax:24});
  assert.equal(model.rows.length,86401);
  assert.equal(model.series[0].runs[0].length,86401);
  assert.equal(nearestSampleIndex(model.rows,23.9999),86400);
  assert.ok(model.yDomain.max>=199);
});

test('candidate points expose named buttons, keyboard selection, and domain-specific performance values',()=>{
  const f=fixture(),selected=[];
  const candidates=[{altitude:500,planes:8,satellites:128,comm:94,nav:50,joint:45,outage:30},{altitude:888,planes:16,satellites:256,comm:99,nav:96,joint:93,outage:0}];
  const {svg,markers}=tradeChart(f.container,candidates,{domain:'commNav',onSelect:candidate=>selected.push(candidate)});
  assert.equal(svg.getAttribute('role'),'group','candidate buttons must remain exposed in the accessibility tree');
  assert.equal(markers[0].getAttribute('role'),'button');
  assert.match(markers[0].getAttribute('aria-label'),/고도 500 km · 위성 128기 · 동시 충족률 45%/);
  markers[0].emit('focus');assert.match(f.byClass('chart-tooltip')[0].textContent,/동시 충족률45%/);
  assert.ok(markers[0].emit('keydown',{key:'Enter'}));assert.equal(selected[0],candidates[0]);
  markers[1].emit('click');assert.equal(selected[1],candidates[1]);
  markers[1].emit('keydown',{key:'ArrowLeft'});assert.equal(f.byClass('chart-tooltip-heading')[0].textContent,'500 km · 128기');
  const comm=tradeChart(f.container,candidates,{domain:'comm'});
  assert.match(comm.markers[0].getAttribute('aria-label'),/통신 충족률 94%/);
  comm.markers[0].emit('focus');assert.doesNotMatch(f.byClass('chart-tooltip')[0].textContent,/항법 충족률|동시 충족률/);
});
