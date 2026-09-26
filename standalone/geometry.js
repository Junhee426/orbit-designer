import {EARTH_RADIUS,C,observerFrame,observe,orbitState} from './engine.js';
const norm=v=>Math.hypot(...v),subtract=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function clearsEarth(a,b) {const d=subtract(b,a),den=dot(d,d);if(!den)return false;const t=Math.max(0,Math.min(1,-dot(a,d)/den));return norm(a.map((x,i)=>x+t*d[i]))>EARTH_RADIUS;}
// The k nearest satellites to s, nearest first; ties keep list order like a stable sort.
// A single pass instead of sorting all N per satellite (which recomputed distances in the comparator).
function nearest(s,list,k) {
  const [x,y,z]=s.position,best=[],dist=[];
  for(const b of list){if(b===s)continue;const d=Math.hypot(b.position[0]-x,b.position[1]-y,b.position[2]-z);
    if(best.length===k&&d>=dist[k-1])continue;
    let i=Math.min(best.length,k-1);while(i>0&&dist[i-1]>d){best[i]=best[i-1];dist[i]=dist[i-1];i--;}
    best[i]=b;dist[i]=d;}
  return best;
}
export function islEdges(states) {
  const leo=states.filter(s=>s.group==='LEO'),byKey=new Map(leo.map(s=>[`${s.shell}:${s.plane}:${s.slot}`,s])),edges=[],used=new Set();
  for(const s of leo) {
    // TLE: a limited nearest-LOS illustrative graph, not operational links.
    const candidates=s.plane<0?nearest(s,leo,4):
      [byKey.get(`${s.shell}:${s.plane}:${(s.slot+1)%s.slots}`),byKey.get(`${s.shell}:${(s.plane+1)%s.planes}:${s.slot}`)];
    for(const b of candidates)if(b&&b!==s){const key=[s.id,b.id].sort().join('|');if(used.has(key))continue;used.add(key);if(clearsEarth(s.position,b.position))edges.push({a:s.id,b:b.id,rangeKm:norm(subtract(s.position,b.position))});}
  }
  return edges;
}
export function routeBetween(states,edges,from,to,elevation) {
  const leo=states.filter(s=>s.group==='LEO'),adj=new Map(leo.map(s=>[s.id,[]])),dist=new Map(),prev=new Map(),queue=[];
  // Small binary heap keeps thousands of satellites practical without O(N²) scans.
  const push=x=>{queue.push(x);let i=queue.length-1;while(i){const p=(i-1)>>1;if(queue[p][0]<=x[0])break;queue[i]=queue[p];i=p;}queue[i]=x;};
  const pop=()=>{const result=queue[0],last=queue.pop();if(queue.length){let i=0;while(2*i+1<queue.length){let k=2*i+1;if(k+1<queue.length&&queue[k+1][0]<queue[k][0])k++;if(queue[k][0]>=last[0])break;queue[i]=queue[k];i=k;}queue[i]=last;}return result;};
  for(const e of edges){const ms=e.rangeKm*1e6/C;adj.get(e.a).push([e.b,ms]);adj.get(e.b).push([e.a,ms]);}
  const source=observerFrame(from.lat,from.lon),target=observerFrame(to.lat,to.lon);
  for(const s of leo){const seen=observe(s,source);if(seen.elevation>=elevation){const ms=seen.range*1e6/C;dist.set(s.id,ms);push([ms,s.id]);}}
  while(queue.length){const [d,u]=pop();if(d!==dist.get(u))continue;for(const [v,c]of adj.get(u)){const next=d+c;if(next<(dist.get(v)??Infinity)){dist.set(v,next);prev.set(v,u);push([next,v]);}}}
  let best=null,cost=Infinity;
  for(const s of leo){const seen=observe(s,target),total=(dist.get(s.id)??Infinity)+seen.range*1e6/C;if(seen.elevation>=elevation&&total<cost){cost=total;best=s.id;}}
  if(!best)return null;const path=[best];while(prev.has(path[0]))path.unshift(prev.get(path[0]));
  return {from:from.name,to:to.name,path,hops:path.length-1,delayMs:cost};
}
export function footprint(position,elevation) {
  const r=norm(position),lat=Math.asin(position[2]/r),lon=Math.atan2(position[1],position[0]);
  if(r<=EARTH_RADIUS)return [];
  const el=elevation*Math.PI/180,angle=Math.acos(EARTH_RADIUS/r*Math.cos(el))-el,points=[];
  for(let i=0;i<=72;i++){const b=i*Math.PI/36,la=Math.asin(Math.sin(lat)*Math.cos(angle)+Math.cos(lat)*Math.sin(angle)*Math.cos(b));
    const lo=lon+Math.atan2(Math.sin(b)*Math.sin(angle)*Math.cos(lat),Math.cos(angle)-Math.sin(lat)*Math.sin(la));points.push([lo*180/Math.PI,la*180/Math.PI]);}
  return points;
}
function insideRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [x,y]=ring[i],[u,v]=ring[j];if((y>lat)!==(v>lat)&&lon<(u-x)*(lat-y)/(v-y)+x)inside=!inside;}return inside;}
export function insideGeometry(lon,lat,geometry){const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];return polygons.some(rings=>insideRing(lon,lat,rings[0])&&!rings.slice(1).some(r=>insideRing(lon,lat,r)));}
// Cell bounds, land mask and observer frames depend only on the country and grid size,
// so they are built once instead of on every time step.
const gridCache=new WeakMap();
function gridCells(country,geometry,points) {
  const cached=gridCache.get(country);
  if(cached?.geometry===geometry&&cached.points===points&&cached.bbox===country.bbox)return cached.cells;
  const [west,south,east,north]=country.bbox,cells=[];
  for(let y=0;y<points;y++)for(let x=0;x<points;x++){
    const lon=west+(x+.5)*(east-west)/points,lat=south+(y+.5)*(north-south)/points;
    if(geometry&&!insideGeometry(lon,lat,geometry))continue;
    const {position,up}=observerFrame(lat,lon);
    cells.push({west:west+x*(east-west)/points,east:west+(x+1)*(east-west)/points,south:south+y*(north-south)/points,north:south+(y+1)*(north-south)/points,position,up});
  }
  gridCache.set(country,{geometry,points,bbox:country.bbox,cells});
  return cells;
}
export function coverageGrid(states,country,elevation,geometry,points=16) {
  const leo=states.filter(s=>s.group==='LEO'),threshold=Math.sin(elevation*Math.PI/180);
  return gridCells(country,geometry,points).map(({west,east,south,north,position:[px,py,pz],up:[ux,uy,uz]})=>{
    let count=0;
    for(const s of leo){const dx=s.position[0]-px,dy=s.position[1]-py,dz=s.position[2]-pz,along=dx*ux+dy*uy+dz*uz;
      // Below the local horizon can never meet a non-negative mask; skip the square root.
      if(along<0&&threshold>=0)continue;
      if(along/Math.hypot(dx,dy,dz)>=threshold)count++;}
    return {west,east,south,north,count};
  });
}
export function groundTrack(orbit,minutes) {
  const period=orbit.satrec?2*Math.PI/orbit.satrec.no:2*Math.PI*Math.sqrt(orbit.radius**3/398600.4418)/60;
  return Array.from({length:97},(_,i)=>orbitState(orbit,(minutes+period*i/96)*60).position);
}
// A non-TLE orbit's full ring at one instant, sampled at `points` positions around it.
// Shared by the Cesium and canvas renderers' orbit-plane display.
export function orbitRing(orbit,minutes,points) {
  return Array.from({length:points},(_,i)=>orbitState(orbit,minutes*60,2*Math.PI*i/(points-1)).position);
}
// The selected satellite's ground track projected onto Earth's surface instead of its
// orbital altitude, for the "shadow track" overlay. Shared by both renderers.
export function groundTrackSurface(orbit,minutes) {
  return groundTrack(orbit,minutes).map(p=>{const scale=EARTH_RADIUS/norm(p);return p.map(v=>v*scale);});
}
