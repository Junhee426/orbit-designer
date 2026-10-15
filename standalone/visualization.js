// Dependency-free SVG charts shared by the analysis and candidate workspaces.
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#55dddb', '#f6b75b', '#b79cff', '#8dbbff'];
const LABELS = {rate:'통신 처리량',baseline:'GNSS 단독',gnssLEO:'GNSS + LEO',hrms:'전체 선택 항법망',comm:'통신 충족률',joint:'동시 충족률'};
let sequence = 0;

const finite = Number.isFinite;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = value => Number(value.toFixed(3));
function number(value, digits = 3) {
  if (!finite(value)) return '—';
  if (value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e7)) return value.toExponential(2);
  return value.toLocaleString('ko-KR', {maximumFractionDigits:digits});
}
function svgNode(doc, tag, attrs = {}, content) {
  const element = doc.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (content !== undefined) element.textContent = content;
  return element;
}
function htmlNode(doc, tag, className, content) {
  const element = doc.createElement(tag);element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function extent(values) {
  let min = Infinity, max = -Infinity;
  for (const value of values) if (finite(value)) {min = Math.min(min, value);max = Math.max(max, value);}
  return min === Infinity ? null : [min, max];
}
function scaleDomain(values) {
  const bounds = extent(values) || [0, 0];
  let min = Math.min(0, bounds[0]), max = Math.max(0, bounds[1]);
  if (min === max) return {min:0,max:1,ticks:[0,.25,.5,.75,1]};
  const padding = (max - min) * .07;
  if (min < 0) min -= padding;
  if (max > 0) max += padding;
  const raw = (max - min) / 4, power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  min = Math.floor(min / step) * step;max = Math.ceil(max / step) * step;
  const ticks = [];
  for (let i = 0, count = Math.round((max - min) / step); i <= count; i++) ticks.push(min + i * step);
  return {min, max, ticks};
}

/** Pure chart geometry. Invalid x coordinates are omitted; missing y values split paths. */
export function createLineChartModel(points, series, options = {}) {
  const xKey = options.xKey || 'hours';
  const rows = points.map((point, sourceIndex) => ({point, sourceIndex, x:point[xKey]}))
    .filter(row => finite(row.x)).sort((a, b) => a.x - b.x || a.sourceIndex - b.sourceIndex);
  const values = rows.flatMap(row => series.map(item => row.point[item.key])).filter(finite);
  const xBounds = extent(rows.map(row => row.x)) || [0, 0];
  const xMin = finite(options.xMin) ? options.xMin : Math.min(0, xBounds[0]);
  const requestedMax = finite(options.xMax) ? options.xMax : xBounds[1];
  const xMax = requestedMax > xMin ? requestedMax : xBounds[1] > xMin ? xBounds[1] : xMin + 1;
  const yDomain = scaleDomain(finite(options.threshold) ? [...values, options.threshold] : values);
  const segments = series.map(item => {
    const runs = [];let run = [];
    for (const row of rows) {
      const value = row.point[item.key];
      if (finite(value)) run.push({x:row.x, y:value, row});
      else if (run.length) {runs.push(run);run = [];}
    }
    if (run.length) runs.push(run);
    return {...item, label:item.label || LABELS[item.key] || item.key, runs};
  });
  return {rows, series:segments, xKey, xMin, xMax, yDomain, hasValues:values.length > 0};
}

/** Return the nearest real sample, including unavailable samples and uneven time intervals. */
export function nearestSampleIndex(rows, value) {
  if (!rows.length || !finite(value)) return -1;
  let lo = 0, hi = rows.length;
  while (lo < hi) {const mid = (lo + hi) >>> 1;if (rows[mid].x < value) lo = mid + 1;else hi = mid;}
  if (lo === 0) return 0;
  if (lo === rows.length) return lo - 1;
  return value - rows[lo - 1].x <= rows[lo].x - value ? lo - 1 : lo;
}

export function elapsedTime(hours) {
  if (!finite(hours)) return '—';
  const sign = hours < 0 ? '−' : '', seconds = Math.round(Math.abs(hours) * 3600);
  return 'T + ' + sign + [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function shell(container, title, type = 'time-chart', height = 294) {
  const doc = container.ownerDocument || document, width = Math.max(320, container.getBoundingClientRect().width || 640);
  const wrapper = htmlNode(doc, 'div', 'interactive-chart');wrapper.style.position = 'relative';
  const svg = svgNode(doc, 'svg', {viewBox:`0 0 ${width} ${height}`, role:'img', 'aria-label':title, class:type});
  svg.style.width = '100%';svg.style.height = 'auto';svg.style.display = 'block';
  svg.append(svgNode(doc, 'title', {}, title));
  const legend = htmlNode(doc, 'div', 'chart-legend');
  const tooltip = htmlNode(doc, 'div', 'chart-tooltip');tooltip.hidden = true;
  tooltip.setAttribute('role', 'status');tooltip.setAttribute('aria-live', 'polite');
  tooltip.style.position = 'absolute';tooltip.style.pointerEvents = 'none';
  const help = htmlNode(doc, 'p', 'chart-help');help.id = `chart-help-${++sequence}`;
  svg.setAttribute('aria-describedby', help.id);
  wrapper.append(legend, svg, tooltip, help);container.replaceChildren(wrapper);
  return {doc, width, height, wrapper, svg, legend, tooltip, help};
}
function legendItem(doc, color, label, dashed = false) {
  const item = htmlNode(doc, 'span', 'chart-legend-item');
  const mark = htmlNode(doc, 'i', 'chart-legend-mark');mark.setAttribute('aria-hidden', 'true');
  mark.style.borderTop = `3px ${dashed ? 'dashed' : 'solid'} ${color}`;
  item.append(mark, doc.createTextNode(label));return item;
}
function tooltipRow(doc, label, value, color, key) {
  const row = htmlNode(doc, 'div', 'chart-tooltip-row');
  if (key) row.setAttribute('data-series', key);
  const name = htmlNode(doc, 'span', 'chart-tooltip-label', label);
  if (color) name.style.color = color;
  row.append(name, htmlNode(doc, 'strong', 'chart-tooltip-value', value));return row;
}
function positionTooltip(parts, plotX) {
  // Position against the responsive SVG, while keeping the tooltip within its card.
  const rect = parts.svg.getBoundingClientRect();
  const renderedX = plotX / parts.width * rect.width;
  const wrapperRect = parts.wrapper.getBoundingClientRect();
  const room = wrapperRect.width || rect.width || parts.width;
  const tooltipWidth = parts.tooltip.getBoundingClientRect().width || Math.min(260, room - 12);
  parts.tooltip.style.left = `${clamp(renderedX + 14, 6, Math.max(6, room - tooltipWidth - 6))}px`;
  parts.tooltip.style.top = `${Math.max(0, rect.top-wrapperRect.top)+26}px`;
}
function axes(parts, xTicks, yTicks, x, y, margins, {xLabel, yLabel} = {}) {
  const {doc, svg, width, height} = parts;
  const right = width - margins.right, bottom = height - margins.bottom;
  svg.append(svgNode(doc, 'rect', {x:margins.left,y:margins.top,width:right-margins.left,height:bottom-margins.top,rx:8,fill:'#0b1b2b','fill-opacity':.45}));
  for (const value of yTicks) {
    const py = y(value);
    svg.append(svgNode(doc, 'line', {x1:margins.left,x2:right,y1:py,y2:py,stroke:'#22394f','stroke-width':1,'stroke-dasharray':value === 0 ? 'none' : '3 5'}));
    svg.append(svgNode(doc, 'text', {x:margins.left-10,y:py+4,fill:'#95aec5','text-anchor':'end','font-size':11.5}, number(value, 2)));
  }
  for (const tick of xTicks) {
    svg.append(svgNode(doc, 'line', {x1:x(tick.value),x2:x(tick.value),y1:bottom,y2:bottom+5,stroke:'#50667b'}));
    svg.append(svgNode(doc, 'text', {x:x(tick.value),y:bottom+22,fill:'#95aec5','text-anchor':'middle','font-size':11.5}, tick.label));
  }
  svg.append(svgNode(doc, 'text', {x:margins.left,y:18,fill:'#b3c8dc','font-size':12}, yLabel || ''));
  if (xLabel) svg.append(svgNode(doc, 'text', {x:(margins.left+right)/2,y:height-5,fill:'#95aec5','text-anchor':'middle','font-size':11.5}, xLabel));
}

/** Accessible line/area plot. Arrow keys inspect actual samples; gaps are never interpolated. */
export function lineChart(container, points, series, options = {}) {
  const model = createLineChartModel(points, series, options);
  const parts = shell(container, options.title || '성능 변화 그래프');
  const {doc, svg, width, height, legend, tooltip, help} = parts;
  const margins = {left:58,right:24,top:36,bottom:48};
  const plotWidth = width - margins.left - margins.right, plotHeight = height - margins.top - margins.bottom;
  const x = value => margins.left + (value - model.xMin) / (model.xMax - model.xMin) * plotWidth;
  const y = value => height - margins.bottom - (value - model.yDomain.min) / (model.yDomain.max - model.yDomain.min) * plotHeight;
  const unit = options.unit ?? (options.yLabel?.includes('(m)') ? 'm' : options.yLabel || '');
  const formattedX = value => options.xFormat ? options.xFormat(value) : options.xKey && options.xKey !== 'hours' ? `${options.xLabel || options.xKey} ${number(value)}` : elapsedTime(value);
  for (const item of model.series) legend.append(legendItem(doc, item.color, item.label));
  const thresholdLabel = finite(options.threshold) ? `목표 ${options.thresholdDirection === 'below' ? '≤' : '≥'} ${number(options.threshold)}${unit ? ' '+unit : ''}` : '';
  if (thresholdLabel) legend.append(legendItem(doc, '#a4b8cb', thresholdLabel, true));
  const tickCount = width < 480 ? 3 : 4;
  const xTicks = Array.from({length:tickCount+1}, (_, i) => {
    const value = model.xMin + (model.xMax - model.xMin) * i / tickCount;
    return {value, label:options.xKey && options.xKey !== 'hours' ? number(value, 1) : number(value*60, 1)+'분'};
  });
  axes(parts, xTicks, model.yDomain.ticks, x, y, margins, {xLabel:options.xLabel || '경과 시간 (분)',yLabel:options.yLabel});
  if (finite(options.threshold)) {
    const above = options.thresholdDirection !== 'below', py = y(options.threshold);
    const bandY = above ? margins.top : py, bandHeight = above ? py - margins.top : height - margins.bottom - py;
    svg.append(svgNode(doc, 'rect', {x:margins.left,y:bandY,width:plotWidth,height:Math.max(0,bandHeight),fill:'#4cd5b0','fill-opacity':.035}));
    svg.append(svgNode(doc, 'line', {x1:margins.left,x2:width-margins.right,y1:py,y2:py,stroke:'#829ab1','stroke-width':1.2,'stroke-dasharray':'5 5'}));
  }
  if (!model.hasValues) {
    svg.append(svgNode(doc, 'text', {x:margins.left+plotWidth/2,y:margins.top+plotHeight/2,'text-anchor':'middle',fill:'#a9bed0','font-size':13}, '이 조건에서는 유효한 성능 표본이 없습니다.'));
  }
  const defs = svgNode(doc, 'defs');svg.append(defs);
  for (const [index, item] of model.series.entries()) {
    const gradientId = `chart-fill-${sequence}-${index}`;
    const gradient = svgNode(doc, 'linearGradient', {id:gradientId,x1:0,y1:0,x2:0,y2:1});
    gradient.append(svgNode(doc, 'stop', {offset:'0%','stop-color':item.color,'stop-opacity':.2}),svgNode(doc, 'stop', {offset:'100%','stop-color':item.color,'stop-opacity':.015}));defs.append(gradient);
    for (const run of item.runs) {
      const path = run.map((point, i) => `${i ? 'L' : 'M'}${rounded(x(point.x))} ${rounded(y(point.y))}`).join(' ');
      if (options.area !== false && run.length > 1) svg.append(svgNode(doc, 'path', {d:`${path} L${rounded(x(run.at(-1).x))} ${rounded(y(0))} L${rounded(x(run[0].x))} ${rounded(y(0))} Z`,fill:`url(#${gradientId})`,'data-area-series':item.key}));
      svg.append(svgNode(doc, 'path', {d:path,stroke:item.color,'stroke-width':item.width || 2.3,fill:'none','stroke-linecap':'round','stroke-linejoin':'round','data-line-series':item.key}));
      if (run.length === 1) svg.append(svgNode(doc, 'circle', {cx:x(run[0].x),cy:y(run[0].y),r:3.2,fill:item.color,'data-single-sample':item.key}));
    }
  }
  const guide = svgNode(doc, 'g', {visibility:'hidden','aria-hidden':'true'});
  const guideLine = svgNode(doc, 'line', {y1:margins.top,y2:height-margins.bottom,stroke:'#c2d6e7','stroke-opacity':.55,'stroke-dasharray':'3 4'});guide.append(guideLine);
  const dots = model.series.map(item => {const dot = svgNode(doc, 'circle', {r:4,fill:item.color,stroke:'#0b1b2b','stroke-width':2});guide.append(dot);return dot;});svg.append(guide);
  let selected = -1, focused = false;
  function inspect(index) {
    if (index < 0 || !model.rows.length) return;
    selected = clamp(index, 0, model.rows.length - 1);
    const row = model.rows[selected], px = x(row.x);
    guide.setAttribute('visibility', 'visible');guideLine.setAttribute('x1', px);guideLine.setAttribute('x2', px);
    tooltip.replaceChildren(htmlNode(doc, 'div', 'chart-tooltip-heading', formattedX(row.x)));
    for (const [i, item] of model.series.entries()) {
      const value = row.point[item.key], itemUnit = item.unit ?? unit;
      dots[i].setAttribute('visibility', finite(value) ? 'visible' : 'hidden');
      if (finite(value)) {dots[i].setAttribute('cx', px);dots[i].setAttribute('cy', y(value));}
      tooltip.append(tooltipRow(doc, item.label, finite(value) ? number(value)+(itemUnit ? ' '+itemUnit : '') : '유효 표본 없음', item.color, item.key));
    }
    if (thresholdLabel) tooltip.append(htmlNode(doc, 'div', 'chart-tooltip-target', thresholdLabel));
    tooltip.hidden = false;positionTooltip(parts, px);
    svg.setAttribute('data-active-sample', String(selected));
  }
  function hide() {tooltip.hidden = true;guide.setAttribute('visibility', 'hidden');svg.removeAttribute('data-active-sample');}
  svg.setAttribute('tabindex', '0');
  svg.append(svgNode(doc, 'desc', {}, '선이 끊긴 곳은 유효한 표본이 없는 구간입니다. 방향키로 각 표본의 정확한 시각과 값을 확인할 수 있습니다.'));
  help.textContent = '마우스를 올리거나 그래프에 초점을 맞춘 뒤 ← → 키로 표본을 확인하세요. 선이 끊긴 구간은 유효 표본이 없습니다.';
  svg.addEventListener('pointermove', event => {
    const rect = svg.getBoundingClientRect();if (!rect.width) return;
    const plotX = clamp((event.clientX - rect.left) / rect.width * width, margins.left, width-margins.right);
    const value = model.xMin + (plotX - margins.left) / plotWidth * (model.xMax - model.xMin);
    inspect(nearestSampleIndex(model.rows, value));
  });
  svg.addEventListener('pointerleave', () => {if (!focused) hide();});
  svg.addEventListener('focus', () => {focused = true;inspect(selected < 0 ? 0 : selected);});
  svg.addEventListener('blur', () => {focused = false;hide();});
  svg.addEventListener('keydown', event => {
    const actions = {ArrowLeft:() => inspect(selected-1),ArrowRight:() => inspect(selected+1),Home:() => inspect(0),End:() => inspect(model.rows.length-1),Escape:hide};
    if (actions[event.key]) {event.preventDefault();actions[event.key]();}
  });
  return {model, inspect, svg};
}

/** Candidate trade-off plot; each point is an accessible candidate-apply button. */
export function tradeChart(container, candidates, {domain = 'commNav', onSelect} = {}) {
  const metric = domain === 'comm' ? 'comm' : 'joint', metricLabel = LABELS[metric];
  const parts = shell(container, `위성 수와 ${metricLabel} 후보 비교`, 'trade-chart', 310);
  const {doc, svg, width, height, legend, tooltip, help} = parts;
  svg.setAttribute('role', 'group');
  const margins = {left:58,right:28,top:32,bottom:52};
  const rows = candidates.filter(candidate => finite(candidate.satellites) && finite(candidate[metric]));
  const counts = [...new Set(rows.map(candidate => candidate.satellites))].sort((a, b) => a-b);
  const altitudes = [...new Set(rows.map(candidate => candidate.altitude))].sort((a, b) => a-b);
  const xMax = Math.max(1, ...counts) * 1.2, plotWidth = width-margins.left-margins.right;
  const x = value => margins.left + value/xMax*plotWidth;
  const y = value => height-margins.bottom-clamp(value, 0, 100)/100*(height-margins.top-margins.bottom);
  axes(parts, counts.map(value => ({value,label:number(value)+'기'})), [0,25,50,75,100], x, y, margins, {xLabel:'위성 수', yLabel:`${metricLabel} (%)`});
  for (const [i, altitude] of altitudes.entries()) legend.append(legendItem(doc, COLORS[i % COLORS.length], number(altitude, 0)+' km'));
  for (const count of counts) svg.append(svgNode(doc, 'line', {x1:x(count),x2:x(count),y1:margins.top,y2:height-margins.bottom,stroke:'#334d65','stroke-dasharray':'3 6'}));
  if (!rows.length) svg.append(svgNode(doc, 'text', {x:width/2,y:height/2,'text-anchor':'middle',fill:'#a9bed0'}, '비교 가능한 후보가 없습니다.'));
  const best = rows.reduce((current, row) => !current || row[metric] > current[metric] || (row[metric] === current[metric] && row.satellites < current.satellites) ? row : current, null);
  const markers = [];
  for (const candidate of rows) {
    const altitudeIndex = altitudes.indexOf(candidate.altitude), color = COLORS[altitudeIndex % COLORS.length];
    const px = x(candidate.satellites) + (altitudeIndex-(altitudes.length-1)/2)*11, py = y(candidate[metric]);
    const label = `고도 ${number(candidate.altitude)} km · 위성 ${number(candidate.satellites,0)}기 · ${metricLabel} ${number(candidate[metric])}%`;
    if (candidate === best) svg.append(svgNode(doc, 'circle', {cx:px,cy:py,r:11,fill:'none',stroke:color,'stroke-opacity':.5,'stroke-width':1.5,'data-best-candidate':'true'}));
    const dot = svgNode(doc, 'circle', {cx:px,cy:py,r:6,fill:color,stroke:'#071521','stroke-width':2,class:'trade-point',tabindex:0,role:'button','aria-label':label+' · 이 후보 적용'});
    dot.append(svgNode(doc, 'title', {}, label));svg.append(dot);markers.push(dot);
    function inspect() {
      tooltip.replaceChildren(htmlNode(doc, 'div', 'chart-tooltip-heading', `${number(candidate.altitude,0)} km · ${number(candidate.satellites,0)}기`),
        tooltipRow(doc, '궤도면', number(candidate.planes,0)+'면'),
        tooltipRow(doc, '통신 충족률', number(candidate.comm)+'%', color, 'comm'));
      if (domain !== 'comm') tooltip.append(tooltipRow(doc, '항법 충족률', number(candidate.nav)+'%', null, 'nav'),tooltipRow(doc, '동시 충족률', number(candidate.joint)+'%', color, 'joint'));
      tooltip.append(tooltipRow(doc, '최장 기하 단절', number(candidate.outage)+'초'));
      if (onSelect) tooltip.append(htmlNode(doc, 'div', 'chart-tooltip-target', '클릭 또는 Enter 키로 후보 적용'));
      tooltip.hidden = false;positionTooltip(parts, px);dot.setAttribute('r', '8');
    }
    function hide() {tooltip.hidden = true;dot.setAttribute('r', '6');}
    dot.addEventListener('pointerenter', inspect);dot.addEventListener('pointerleave', hide);
    dot.addEventListener('focus', inspect);dot.addEventListener('blur', hide);
    dot.addEventListener('click', () => onSelect?.(candidate));
    dot.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();onSelect?.(candidate);}
      else if (event.key === 'Escape') hide();
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {event.preventDefault();markers[(markers.indexOf(dot)+(event.key === 'ArrowRight' ? 1 : -1)+markers.length)%markers.length].focus();}
    });
  }
  svg.append(svgNode(doc, 'desc', {}, '세로축은 모든 관측지 중 최저 목표 충족률입니다. 같은 위성 수의 점은 고도를 구분하도록 조금씩 벌렸습니다. 바깥 원은 최고 충족률 후보를 표시하며 동률일 때 위성 수가 적은 후보입니다.'));
  help.textContent = '같은 위성 수의 점은 고도별로 조금씩 벌려 표시합니다. 바깥 원: 최고 충족률 (동률이면 적은 위성 수). 점을 클릭하거나 Tab · Enter 키로 후보를 적용하세요.';
  return {svg, markers};
}
