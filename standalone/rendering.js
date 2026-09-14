import { EARTH_RADIUS, observerFrame, orbitState } from './engine.js';
import { footprint, groundTrack } from './geometry.js';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { LEO: '#48d4f0', GNSS: '#f6b75b', REGIONAL: '#c1a0ff' };
const TWO_PI = Math.PI * 2;
function node(tag, attributes = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attributes)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export class Globe {
  constructor(canvas,worldLines=[]) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.lat = 25; this.lon = 120; this.full = false; this.mode = 'globe'; this.earthStyle = 'image'; this.worldLines = worldLines; this.cached = null;
    this.satShape = 'circle'; this.satSize = 1; this.orbitWidth = 1;
    this.showOrbits = true; this.showIsl = false; this.showHeatmap = false; this.showFootprint = true; this.commElevation = 20;
    this.texture = null; this.snapshot = null; this.orbits = []; this.selectedId = null; this.edges = []; this.cells = [];
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas'); off.width = img.width; off.height = img.height;
      const c = off.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0);
      this.texture = { width: img.width, height: img.height, data: c.getImageData(0, 0, img.width, img.height).data };
      this.cached = null; this.draw();
    };
    img.src = './earth.jpg';
    this.resizeObserver = new ResizeObserver(() => { this.cached = null; this.draw(); });
    this.resizeObserver.observe(canvas);
    let drag = null, raf = null;
    canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      this.lon -= (e.clientX - drag[0]) * .35;
      this.lat = Math.max(-80, Math.min(80, this.lat + (e.clientY - drag[1]) * .3));
      drag = [e.clientX, e.clientY]; this.cached = null;
      if (raf === null) raf = requestAnimationFrame(() => { raf = null; this.draw(); });
    });
    const stop = () => { drag = null; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('lostpointercapture', stop);
  }
  set(snapshot, orbits, selectedId = null, edges = [], cells = []) {
    this.snapshot = snapshot; this.orbits = orbits; this.selectedId = selectedId; this.edges = edges; this.cells = cells; this.draw();
  }
  setLayers(orbits, isl, heatmap, footprint, commElevation) {
    this.showOrbits = !!orbits; this.showIsl = !!isl; this.showHeatmap = !!heatmap; this.showFootprint = !!footprint;
    if (Number.isFinite(commElevation)) this.commElevation = commElevation;
  }
  center(lat, lon) { this.lat = lat; this.lon = lon; this.cached = null; this.draw(); }
  setFull(value) { this.full = value; this.cached = null; this.draw(); }
  setMode(value) { const next = value === 'map' ? 'map' : 'globe'; if (next === this.mode) return; this.mode = next; this.cached = null; this.draw(); }
  setEarthStyle(value) { const next = value === 'outline' ? 'outline' : 'image'; if(next === this.earthStyle) return; this.earthStyle = next; this.cached = null; this.draw(); }
  setStyle(shape, size, orbitWidth) {
    const nextShape = ['circle','square','diamond'].includes(shape) ? shape : 'circle';
    const nextSize = Number.isFinite(size) ? size : 1, nextOrbitWidth = Number.isFinite(orbitWidth) ? orbitWidth : 1;
    if (nextShape === this.satShape && nextSize === this.satSize && nextOrbitWidth === this.orbitWidth) return;
    this.satShape = nextShape; this.satSize = nextSize; this.orbitWidth = nextOrbitWidth; this.draw();
  }
  background(size, frame) {
    const key = [size, this.lat, this.lon, !!this.texture].join(':');
    if (this.cached?.key === key) return this.cached.canvas;
    const off = document.createElement('canvas'); off.width = off.height = size;
    const context = off.getContext('2d');
    const pixels = context.createImageData(size, size), d = pixels.data;
    const r = size / 2, tex = this.texture;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const ex = (x + .5 - r) / r, ny = -(y + .5 - r) / r, dist = ex * ex + ny * ny;
      if (dist > 1) continue;
      const uz = Math.sqrt(1 - dist), index = (y * size + x) * 4;
      const worldX = frame.east[0] * ex + frame.north[0] * ny + frame.up[0] * uz;
      const worldY = frame.east[1] * ex + frame.north[1] * ny + frame.up[1] * uz;
      const worldZ = frame.east[2] * ex + frame.north[2] * ny + frame.up[2] * uz;
      const lon = Math.atan2(worldY, worldX), lat = Math.asin(Math.max(-1, Math.min(1, worldZ)));
      const light = .42 + .58 * uz;
      if (tex) {
        const tx = Math.min(tex.width - 1, Math.floor((lon / TWO_PI + .5) * tex.width));
        const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((.5 - lat / Math.PI) * tex.height)));
        const offset = (ty * tex.width + tx) * 4;
        d[index] = tex.data[offset] * light; d[index + 1] = tex.data[offset + 1] * light; d[index + 2] = tex.data[offset + 2] * light;
      } else { d[index] = 20 * light; d[index + 1] = 75 * light; d[index + 2] = 120 * light; }
      d[index + 3] = Math.min(255, (1 - dist) * size * 180);
    }
    context.putImageData(pixels, 0, 0); this.cached = { key, canvas: off }; return off;
  }
  draw() {
    if (!this.snapshot || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const map = this.mode === 'map';
    const shown = this.orbits.filter(o => this.full || o.group === 'LEO');
    const maxRadius = Math.max(...shown.map(o => o.radius)) / EARTH_RADIUS;
    const radius = Math.min(w * .44, h * .43) / maxRadius;
    const cx = w / 2, cy = h / 2 + 2, frame = observerFrame(this.lat, this.lon);
    const globeProject = p => ({ x: cx + dot(p, frame.east) / EARTH_RADIUS * radius,
      y: cy - dot(p, frame.north) / EARTH_RADIUS * radius, z: dot(p, frame.up) / EARTH_RADIUS });
    const mapProject = p => {
      const r = Math.hypot(...p) || 1;
      const lat = Math.asin(Math.max(-1, Math.min(1, p[2] / r))) * 180 / Math.PI, lon = Math.atan2(p[1], p[0]) * 180 / Math.PI;
      return { x: 18 + (lon + 180) / 360 * (w - 36), y: 20 + (90 - lat) / 180 * (h - 60), z: 1 };
    };
    const project = map ? mapProject : globeProject;
    const unoccluded = map ? () => true : q => q.z >= 0 || Math.hypot(q.x - cx, q.y - cy) >= radius;
    // In map mode nothing is occluded, so a line breaks on a big horizontal jump (antimeridian wrap) instead.
    const stroke = (points, color, width) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width;
      let prior = false, lastX = null;
      for (const p of points) {
        const q = project(p);
        const show = unoccluded(q) && !(map && lastX !== null && Math.abs(q.x - lastX) > w / 2);
        if (show && prior) ctx.lineTo(q.x, q.y); else if (show) ctx.moveTo(q.x, q.y);
        prior = show; lastX = q.x;
      }
      ctx.stroke();
    };
    const surface = (lat, lon) => { lat *= Math.PI / 180; lon *= Math.PI / 180; const c = Math.cos(lat); return [EARTH_RADIUS*c*Math.cos(lon),EARTH_RADIUS*c*Math.sin(lon),EARTH_RADIUS*Math.sin(lat)]; };
    if (this.showOrbits) {
      const orbitPlanes = new Map();
      shown.forEach(o => { const key = o.group + ':' + o.raan.toFixed(6) + ':' + o.inclination.toFixed(6); if (!orbitPlanes.has(key)) orbitPlanes.set(key, o); });
      for (const o of orbitPlanes.values()) {
        const color = o.group === 'LEO' ? 'rgba(72,212,240,.20)' : o.group === 'GNSS' ? 'rgba(246,183,91,.25)' : 'rgba(193,160,255,.26)';
        stroke(Array.from({ length: 121 }, (_, i) => orbitState(o, this.snapshot.minutes * 60, TWO_PI * i / 120).position), color, .65 * this.orbitWidth);
      }
    }
    if (!map && this.earthStyle === 'image') {
      const gradient = ctx.createRadialGradient(cx, cy, radius * .96, cx, cy, radius * 1.09);
      gradient.addColorStop(0, 'rgba(43,150,201,.24)'); gradient.addColorStop(1, 'rgba(43,150,201,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(cx, cy, radius * 1.09, 0, TWO_PI); ctx.fill();
      const textureSize = Math.max(32, Math.min(650, Math.round(radius * 2 * dpr)));
      ctx.drawImage(this.background(textureSize, frame), cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      if (!map) { ctx.fillStyle = '#091a28'; ctx.strokeStyle = '#5f8aa3'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TWO_PI); ctx.fill(); ctx.stroke(); }
      for(let lat=-60;lat<=60;lat+=30)stroke(Array.from({length:121},(_,i)=>surface(lat,-180+i*3)),lat===0?'#355d76':'#203f55',.7);
      for(let lon=-180;lon<180;lon+=30)stroke(Array.from({length:61},(_,i)=>surface(-90+i*3,lon)),'#203f55',.7);
      for(const outline of this.worldLines)stroke(outline.map(([lat,lon])=>surface(lat,lon)),'#5f8aa3',.9);
    }
    if (this.showHeatmap) {
      for (const cell of this.cells) {
        const corners = [[cell.south,cell.west],[cell.south,cell.east],[cell.north,cell.east],[cell.north,cell.west]].map(([la,lo]) => project(surface(la, lo)));
        if (corners.some(q => !unoccluded(q))) continue;
        ctx.fillStyle = cell.count ? `hsla(172,70%,${(30 + Math.min(cell.count, 12) / 40 * 100).toFixed(0)}%,.55)` : 'rgba(196,82,89,.55)';
        ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y); for (let k = 1; k < 4; k++) ctx.lineTo(corners[k].x, corners[k].y); ctx.closePath(); ctx.fill();
      }
    }
    if (map) {
      ctx.font = '11px system-ui'; ctx.fillStyle = '#7793ae'; ctx.textAlign = 'center';
      for (let lon = -180; lon <= 180; lon += 60) { const p = project(surface(0, lon)); ctx.fillText(lon + '°', p.x, h - 6); }
      ctx.textAlign = 'left';
      for (let lat = -60; lat <= 60; lat += 30) { const p = project(surface(lat, -180)); ctx.fillText(lat + '°', p.x + 3, p.y - 4); }
    }
    const obs = project(this.snapshot.observer);
    if (map || obs.z >= 0) {
      for (const sat of this.snapshot.satellites) {
        if (!this.full || sat.group !== 'LEO' || !sat.navUsed) continue;
        const q = project(sat.position); if (!unoccluded(q)) continue;
        ctx.strokeStyle = 'rgba(72,212,240,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(obs.x, obs.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      if (this.snapshot.best) {
        const q = project(this.snapshot.best.position); ctx.strokeStyle = '#f6b75b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(obs.x, obs.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    if (this.showIsl && this.edges.length) {
      const byId = new Map(this.snapshot.satellites.map(s => [s.id, s]));
      for (const e of this.edges) {
        const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue;
        stroke([a.position, b.position], '#36685f', 1);
      }
    }
    for (const sat of this.snapshot.satellites) {
      if (!this.full && sat.group !== 'LEO') continue;
      const q = project(sat.position); if (!unoccluded(q)) continue;
      const selected = sat.id === this.selectedId, chosen = sat.id === this.snapshot.best?.id, navUsed = this.full && sat.navUsed;
      ctx.globalAlpha = map ? 1 : q.z < 0 ? .4 : sat.group === 'LEO' && !navUsed ? .55 : 1;
      ctx.fillStyle = selected ? '#ffffff' : chosen ? '#f6b75b' : COLORS[sat.group];
      const r = (selected || chosen ? 4.8 : navUsed ? 3.2 : 1.8) * this.satSize;
      ctx.beginPath();
      if (this.satShape === 'square') ctx.rect(q.x - r, q.y - r, r * 2, r * 2);
      else if (this.satShape === 'diamond') { ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); }
      else ctx.arc(q.x, q.y, r, 0, TWO_PI);
      ctx.fill();
      if (selected) { ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, r + 4, 0, TWO_PI); ctx.stroke(); }
      if (chosen) {
        ctx.globalAlpha = 1; ctx.font = '13px system-ui'; ctx.fillStyle = '#ffe0ae';
        ctx.fillText(sat.id, Math.min(w - 42, Math.max(5, q.x + 9)), Math.max(16, q.y - 5));
      }
    }
    ctx.globalAlpha = 1;
    if (this.selectedId) {
      const selSat = this.snapshot.satellites.find(s => s.id === this.selectedId), selOrbit = this.orbits.find(o => o.id === this.selectedId);
      if (this.showFootprint && selSat) {
        const ring = footprint(selSat.position, this.commElevation).map(([lon, lat]) => project(surface(lat, lon)));
        if (ring.length && ring.every(unoccluded)) {
          ctx.beginPath(); ring.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.closePath();
          ctx.fillStyle = 'rgba(132,229,223,.15)'; ctx.strokeStyle = '#84e5df'; ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
        }
      }
      if (selOrbit) {
        const track = groundTrack(selOrbit, this.snapshot.minutes).map(p => { const scale = EARTH_RADIUS / Math.hypot(...p); return p.map(v => v * scale); });
        stroke(track, '#e8db91', 2);
      }
    }
    if (map || obs.z >= 0) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#48d4f0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(obs.x, obs.y, 4, 0, TWO_PI); ctx.fill(); ctx.stroke();
      ctx.font = '14px system-ui'; ctx.fillText(this.snapshot.location.name, Math.min(w - 80, obs.x + 10), Math.max(20, obs.y + 17));
    }
  }
}
export function skyPlot(container, snapshot) {
  const w = 310, cx = 155, cy = 149, r = 117;
  const svg = node('svg', { viewBox: '0 0 310 302', role: 'img', 'aria-label': '관측지에서 보이는 위성의 방위각과 고도각', class: 'sky-svg' });
  svg.append(node('title', {}, '가시 위성 하늘보기'));
  svg.append(node('desc', {}, '중앙은 천정, 바깥 원은 지평선입니다. LEO는 청록색 원, GNSS는 주황색 사각형, 지역항법 예시는 보라색 마름모입니다.'));
  for (const elev of [0, 30, 60]) {
    svg.append(node('circle', { cx, cy, r: r * (1 - elev / 90), fill: 'none', stroke: '#2c3d55', 'stroke-width': 1 }));
    if (elev) svg.append(node('text', { x: cx + 4, y: cy - r * (1 - elev / 90) - 5, fill: '#8b9eb8', 'font-size': 12 }, elev + '°'));
  }
  svg.append(node('path', { d: 'M38 149H272 M155 32V266', stroke: '#27384f', fill: 'none' }));
  for (const [text, x, y] of [['N',155,19],['E',288,154],['S',155,291],['W',21,154]])
    svg.append(node('text', { x, y, 'text-anchor': 'middle', fill: '#c4d3e5', 'font-size': 14 }, text));
  for (const sat of snapshot.satellites.filter(s => s.elevation >= 0 && (s.navUsed || s.id === snapshot.best?.id))) {
    const a = sat.azimuth * Math.PI / 180, rr = r * (1 - sat.elevation / 90);
    const x = cx + rr * Math.sin(a), y = cy - rr * Math.cos(a);
    let mark;
    if (sat.group === 'GNSS') mark = node('rect', { x: x - 4, y: y - 4, width: 8, height: 8, rx: 1, fill: COLORS.GNSS });
    else if (sat.group === 'REGIONAL') mark = node('path', { d: `M${x} ${y-5}L${x+5} ${y}L${x} ${y+5}L${x-5} ${y}Z`, fill: COLORS.REGIONAL });
    else mark = node('circle', { cx: x, cy: y, r: 4, fill: COLORS.LEO });
    mark.append(node('title', {}, sat.id + ' · 고도각 ' + sat.elevation.toFixed(1) + '° · ' + sat.range.toFixed(0) + ' km')); svg.append(mark);
    if (sat.id === snapshot.best?.id) svg.append(node('circle', { cx: x, cy: y, r: 8, fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }));
  }
  container.replaceChildren(svg);
}
export function lineChart(container, points, series, options = {}) {
  const width = Math.max(280, container.getBoundingClientRect().width), height = 260;
  const margin = { left: 58, right: 22, top: 30, bottom: 42 };
  const all = points.flatMap(p => series.map(s => p[s.key])).filter(Number.isFinite);
  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': options.title || '시간별 성능 그래프', class: 'time-chart' });
  svg.append(node('title', {}, options.title || '성능 그래프'));
  if (!all.length) { svg.append(node('text', { x: width/2, y: height/2, 'text-anchor': 'middle', fill: '#a8bad0' }, '이 조건에서는 유효한 측위 결과가 없습니다.')); container.replaceChildren(svg); return; }
  const max = Math.max(...all, options.threshold || 0) * 1.12 || 1;
  const xMax = options.xMax ?? 24, xKey = options.xKey || 'hours';
  const x = value => margin.left + value / xMax * (width - margin.left - margin.right);
  const y = value => height - margin.bottom - value / max * (height - margin.top - margin.bottom);
  svg.append(node('text', { x: margin.left, y: 17, fill: '#a8bad0', 'font-size': 13 }, options.yLabel || ''));
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, py = y(v);
    svg.append(node('line', { x1: margin.left, x2: width-margin.right, y1: py, y2: py, stroke: '#233348' }));
    svg.append(node('text', { x: margin.left-9, y: py+4, fill: '#92a7c1', 'text-anchor': 'end', 'font-size': 12 }, max > 20 ? Math.round(v) : v.toFixed(1)));
  }
  const ticks = width < 450 ? 3 : 4;
  for (let i = 0; i <= ticks; i++) {
    const v = xMax * i / ticks;
    svg.append(node('text', { x: x(v), y: height-21, fill: '#92a7c1', 'text-anchor': 'middle', 'font-size': 12 }, options.xLabel ? Math.round(v) : xMax < 1 ? Math.round(v*60) + '분' : Number(v.toFixed(1)) + 'h'));
  }
  if (options.threshold !== undefined) {
    svg.append(node('line', { x1: margin.left, x2: width-margin.right, y1: y(options.threshold), y2: y(options.threshold), stroke: '#7b8fa9', 'stroke-dasharray': '4 5' }));
  }
  for (const s of series) {
    let path = '', open = false;
    for (const p of points) {
      const v = p[s.key];
      if (!Number.isFinite(v)) { open = false; continue; }
      path += (open ? 'L' : 'M') + x(p[xKey]).toFixed(2) + ' ' + y(v).toFixed(2) + ' '; open = true;
    }
    svg.append(node('path', { d: path, stroke: s.color, 'stroke-width': s.width || 2, fill: 'none', 'stroke-linejoin': 'round' }));
  }
  if (options.xLabel) svg.append(node('text', { x: (margin.left+width-margin.right)/2, y: height-2, 'text-anchor':'middle', fill:'#a8bad0', 'font-size':12 }, options.xLabel));
  container.replaceChildren(svg);
}
