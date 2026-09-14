// K-LEO COMM/PNT: deterministic circular-orbit design model, not operational ephemerides.
import { twoline2satrec, sgp4, gstime } from './vendor/satellite.es.js';
export const MODEL_VERSION = '2.0.0';
export const J2 = 1.08262668e-3;
export const EARTH_RADIUS = 6378.137; // km; spherical Earth approximation
export const MU = 398600.4418; // km^3/s^2
export const EARTH_RATE = 7.292115e-5; // rad/s
export const C = 299792458; // m/s, exact
const TAU = 2 * Math.PI;
const RAD = Math.PI / 180;
export const LOCATIONS = {
  seoul: { name: '서울', lat: 37.5665, lon: 126.978 },
  busan: { name: '부산', lat: 35.1796, lon: 129.0756 },
  jeju: { name: '제주', lat: 33.4996, lon: 126.5312 },
  abudhabi: { name: '아부다비', lat: 24.4539, lon: 54.3773 },
  singapore: { name: '싱가포르', lat: 1.3521, lon: 103.8198 },
  jakarta: { name: '자카르타', lat: -6.2088, lon: 106.8456 },
};
export const DEFAULT_CONFIG = Object.freeze({
  altitude: 1280, inclination: 42, planes: 8, satellitesPerPlane: 16,
  phasing: 1, j2: true, mode: 'walker', shells: [], tleText: '', startUtc: '',
  location: 'seoul', latitude: 37.5665, longitude: 126.978, commElevation: 20, navElevation: 10,
  leoNav: true, payloadPercent: 100, regional: false,
  sharing: 'separate', navShare: 10,
  gnssSigma: 3, leoSigma: 1.5, orbitSigma: 1, clockNs: 3,
  eirp: 45, gt: 5, bandwidth: 100, frequency: 20, rainLoss: 4,
  horizontalTarget: 10, rateTarget: 100, dataRate: 200, requiredEbn0: 4.5, otherLoss: 2,
});
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('설정 형식을 확인해 주세요.');
  const known = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(input)) if (!known.has(key)) throw new Error('알 수 없는 설정: ' + key);
  const cfg = { ...DEFAULT_CONFIG, ...input };
  const limits = {
    altitude: [160, 3000], inclination: [0, 180], planes: [1, 128], satellitesPerPlane: [1, 256], phasing: [0, 127],
    latitude: [-90, 90], longitude: [-180, 180],
    commElevation: [0, 90], navElevation: [0, 90], payloadPercent: [0, 100], navShare: [0, 40],
    gnssSigma: [0.1, 30], leoSigma: [0.1, 30], orbitSigma: [0, 30], clockNs: [0, 1000],
    eirp: [20, 65], gt: [-10, 30], bandwidth: [1, 500], frequency: [10, 40], rainLoss: [0, 40],
    horizontalTarget: [0.1, 100], rateTarget: [1, 1000], dataRate: [0.1, 10000], requiredEbn0: [-20, 40], otherLoss: [0, 50],
  };
  for (const [key, [lo, hi]] of Object.entries(limits)) {
    if (typeof cfg[key] !== 'number' || !Number.isFinite(cfg[key]) || cfg[key] < lo || cfg[key] > hi)
      throw new Error(key + ': ' + lo + '–' + hi + ' 범위의 수치를 입력해 주세요.');
  }
  if (!Number.isInteger(cfg.planes) || !Number.isInteger(cfg.satellitesPerPlane)) throw new Error('궤도면·위성 수는 정수여야 합니다.');
  if (!Number.isInteger(cfg.phasing) || cfg.phasing >= cfg.planes) throw new Error('Walker F는 0 이상 궤도면 수 미만의 정수입니다.');
  for (const key of ['leoNav', 'regional', 'j2']) if (typeof cfg[key] !== 'boolean') throw new Error(key + ' 값을 확인해 주세요.');
  if (!['walker', 'multi_shell', 'tle'].includes(cfg.mode)) throw new Error('궤도 모델을 확인해 주세요.');
  if (!Array.isArray(cfg.shells) || cfg.shells.length > 8) throw new Error('궤도층은 최대 8개입니다.');
  if (cfg.mode === 'multi_shell' && !cfg.shells.length) throw new Error('궤도층을 추가해 주세요.');
  const ids = new Set();
  cfg.shells = cfg.shells.map((shell, index) => {
    if (!shell || typeof shell !== 'object' || Array.isArray(shell)) throw new Error('궤도층 형식을 확인해 주세요.');
    const allowed = ['id','altitude','inclination','planes','satellitesPerPlane','phasing','j2'];
    if (Object.keys(shell).some(k => !allowed.includes(k))) throw new Error('알 수 없는 궤도층 설정');
    const id = shell.id ?? `SH${index + 1}`;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(id) || ids.has(id)) throw new Error('궤도층 ID는 서로 다른 영문·숫자입니다.');
    ids.add(id);
    const { id: shellId, ...values } = shell;
    const checked = validateConfig({ ...cfg, ...values, mode: 'walker', shells: [] });
    return Object.fromEntries(allowed.map(k => [k, k === 'id' ? id : checked[k]]));
  });
  if (typeof cfg.tleText !== 'string' || cfg.tleText.length > 200000 || typeof cfg.startUtc !== 'string') throw new Error('TLE 입력 형식을 확인해 주세요.');
  if (cfg.startUtc && (!/(Z|[+-]\d\d:\d\d)$/.test(cfg.startUtc) || !Number.isFinite(Date.parse(cfg.startUtc)))) throw new Error('시작 시각은 시간대가 있는 ISO UTC 형식이어야 합니다.');
  const total = cfg.mode === 'multi_shell' ? cfg.shells.reduce((n,s) => n+s.planes*s.satellitesPerPlane,0) : cfg.planes*cfg.satellitesPerPlane;
  if (cfg.mode !== 'tle' && total > 4096) throw new Error('총 4,096기까지 지원합니다.');
  if (typeof cfg.location !== 'string' || (cfg.location !== 'custom' && !Object.hasOwn(LOCATIONS, cfg.location))) throw new Error('관측지를 선택해 주세요.');
  if (!['separate', 'time'].includes(cfg.sharing)) throw new Error('신호 공유 방식을 선택해 주세요.');
  return cfg;
}
export function getLocation(config) {
  return config.location === 'custom'
    ? { name: '사용자 지정', lat: config.latitude, lon: config.longitude }
    : LOCATIONS[config.location];
}
export function observerFrame(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return { position: up.map(x => x * EARTH_RADIUS), up,
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)] };
}
export function orbitState(orbit, timeSeconds, phaseOverride) {
  if (orbit.satrec) {
    const when = orbit.startMs + timeSeconds * 1000;
    const result = sgp4(orbit.satrec, (when - orbit.epochMs) / 60000);
    if (!result?.position || !result.velocity || orbit.satrec.error) throw new Error(`${orbit.id}: SGP4 전파 실패 (${orbit.satrec.error})`);
    return rotateState(Object.values(result.position), Object.values(result.velocity), gstime(new Date(when)));
  }
  const a = orbit.radius, n = Math.sqrt(MU / (a * a * a));
  const u = (phaseOverride ?? orbit.phase) + n * timeSeconds;
  const cu = Math.cos(u), su = Math.sin(u);
  // raan/inclination are fixed per orbit; buildConstellations precomputes their cos/sin once
  // instead of every call, since this runs per satellite per sample (up to ~536 x 288 per day).
  const rate = orbit.raanRate || 0;
  const co = Math.cos(orbit.raan + rate*timeSeconds), so = Math.sin(orbit.raan + rate*timeSeconds), ci = orbit.incCos, si = orbit.incSin;
  const inertial = [a * (co * cu - so * su * ci), a * (so * cu + co * su * ci), a * su * si];
  const velocity = [a * n * (-co * su - so * cu * ci), a * n * (-so * su + co * cu * ci), a * n * cu * si];
  velocity[0] -= rate * inertial[1]; velocity[1] += rate * inertial[0];
  return rotateState(inertial, velocity, (orbit.earthAngle || 0) + EARTH_RATE*timeSeconds);
}
function rotateState(inertial, velocity, theta) {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const p = [ct * inertial[0] + st * inertial[1], -st * inertial[0] + ct * inertial[1], inertial[2]];
  const v = [ct * velocity[0] + st * velocity[1] + EARTH_RATE * p[1],
    -st * velocity[0] + ct * velocity[1] - EARTH_RATE * p[0], velocity[2]];
  if (![...p,...v].every(Number.isFinite)) throw new Error('위성 상태가 유효하지 않습니다.');
  return { position: p, velocity: v, inertial, inertialVelocity: velocity };
}
export function parseTLE(text, startUtc = '') {
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean), out = [];
  if (!lines.length || lines.length > 1536) throw new Error('TLE는 1–512기까지 입력해 주세요.');
  for (let i=0;i<lines.length;) {
    const name = lines[i].startsWith('1 ') ? '' : lines[i++].replace(/^0 /,'');
    const l1=lines[i++],l2=lines[i++];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ') || l1.slice(2,7)!==l2.slice(2,7) || l1.length<63 || l2.length<63) throw new Error('TLE 1행·2행과 위성 번호를 확인해 주세요.');
    const fields=[l1.slice(18,20),l1.slice(20,32),l2.slice(8,16),l2.slice(17,25),l2.slice(34,42),l2.slice(43,51),l2.slice(52,63)];
    if (fields.some(s=>!s.trim() || !Number.isFinite(Number(s))) || !/^\d{7}$/.test(l2.slice(26,33))) throw new Error('TLE 숫자 필드가 유효하지 않습니다.');
    const satrec=twoline2satrec(l1,l2), year2=Number(l1.slice(18,20)), year=year2<57?2000+year2:1900+year2;
    const days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000,epochDay=Number(l1.slice(20,32));
    if(epochDay<1||epochDay>=days+1||Number(l2.slice(8,16))<0||Number(l2.slice(8,16))>180||Object.values(satrec).some(v=>typeof v==='number'&&!Number.isFinite(v))) throw Error('TLE epoch·경사각·숫자 필드를 확인해 주세요.');
    const epochMs=Date.UTC(year,0,1)+(Number(l1.slice(20,32))-1)*86400000;
    if (!Number.isFinite(epochMs) || !Number.isFinite(satrec.no) || satrec.no<=0 || satrec.error) throw new Error('TLE 궤도 요소가 유효하지 않습니다.');
    out.push({ id:'NORAD-'+l1.slice(2,7).trim(), name:name||l1.slice(2,7).trim(), satrec, epochMs, group:'LEO', shell:'TLE', plane:-1,slot:out.length });
  }
  if(out.length>512 || new Set(out.map(o=>o.id)).size!==out.length) throw new Error('TLE는 중복 없이 최대 512기입니다.');
  // Date.parse truncates sub-millisecond UTC precision; retain it for SGP4.
  const fraction=startUtc.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1];
  const fractionalMs=fraction?Number('0.'+fraction)*1000:0;
  const startMs=startUtc?Date.parse(startUtc)+fractionalMs-Math.floor(fractionalMs):Math.max(...out.map(o=>o.epochMs));
  if (!Number.isFinite(startMs)) throw new Error('TLE 시작 시각이 유효하지 않습니다.');
  return out.map(o=>({...o,startMs}));
}
export function buildConstellations(config) {
  const cfg = validateConfig(config), out = [];
  const shells=cfg.mode==='multi_shell'?cfg.shells:[{...cfg,id:'SH1'}];
  if(cfg.mode==='tle') out.push(...parseTLE(cfg.tleText,cfg.startUtc));
  else for(const shell of shells) {
    const total=shell.planes*shell.satellitesPerPlane;
    const radius=EARTH_RADIUS+shell.altitude, inclination=shell.inclination*RAD;
    const rate=shell.j2 ? -1.5*J2*Math.sqrt(MU/radius**3)*(EARTH_RADIUS/radius)**2*Math.cos(inclination) : 0;
    for(let p=0;p<shell.planes;p++) for(let s=0;s<shell.satellitesPerPlane;s++) out.push({
      id:`${shell.id}/P${String(p+1).padStart(2,'0')}-S${String(s+1).padStart(2,'0')}`, group:'LEO',shell:shell.id,plane:p,slot:s,
      planes:shell.planes,slots:shell.satellitesPerPlane,radius,inclination,raan:TAU*p/shell.planes,raanRate:rate,
      phase:TAU*s/shell.satellitesPerPlane+TAU*shell.phasing*p/total
    });
  }
  out.forEach((o,i)=>o.payload=cfg.leoNav && Math.floor((i+1)*cfg.payloadPercent/100+1e-9)>Math.floor(i*cfg.payloadPercent/100+1e-9));
  // Idealized 24-satellite MEO reference; not live GPS/Galileo broadcast orbits.
  for (let p = 0; p < 6; p++) for (let s = 0; s < 4; s++) {
    out.push({ id: 'G' + String(p * 4 + s + 1).padStart(2, '0'), group: 'GNSS', payload: true,
      radius: EARTH_RADIUS + 20200, inclination: 55 * RAD,
      raan: TAU * p / 6, phase: TAU * s / 4 + TAU * p / 24 + 0.35 });
  }
  if (cfg.regional) {
    const radius = Math.cbrt(MU / (EARTH_RATE * EARTH_RATE));
    for (let i = 0; i < 3; i++) out.push({ id: 'R' + (i + 1), group: 'REGIONAL', payload: true,
      radius, inclination: 0, raan: (120 + i * 8) * RAD, phase: 0 });
    for (let i = 0; i < 5; i++) {
      const phase = TAU * i / 5;
      out.push({ id: 'R' + (i + 4), group: 'REGIONAL', payload: true,
        radius, inclination: 43 * RAD, raan: 128 * RAD - phase, phase });
    }
  }
  const earthAngle=cfg.mode==='tle'?gstime(new Date(out[0].startMs)):0;
  return out.map(o => ({ ...o, earthAngle, raanCos: Math.cos(o.raan), raanSin: Math.sin(o.raan), incCos: Math.cos(o.inclination), incSin: Math.sin(o.inclination) }));
}
export function observe(state, frame) {
  // Scalar math instead of .map()-built intermediate arrays: called per satellite per sample
  // (up to ~536 x 288 for a full-day run), so the array allocations here were real GC pressure.
  const dx = state.position[0] - frame.position[0], dy = state.position[1] - frame.position[1], dz = state.position[2] - frame.position[2];
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lx = dx / range, ly = dy / range, lz = dz / range;
  const e = lx * frame.east[0] + ly * frame.east[1] + lz * frame.east[2];
  const n = lx * frame.north[0] + ly * frame.north[1] + lz * frame.north[2];
  const u = lx * frame.up[0] + ly * frame.up[1] + lz * frame.up[2];
  const rangeRate = state.velocity[0] * lx + state.velocity[1] * ly + state.velocity[2] * lz;
  return { range, elevation: Math.asin(Math.max(-1, Math.min(1, u))) / RAD,
    azimuth: (Math.atan2(e, n) / RAD + 360) % 360, losENU: [e, n, u], rangeRate };
}
export function invert(matrix) {
  const n = matrix.length, max = Math.max(...matrix.flat().map(Math.abs));
  if (!Number.isFinite(max) || max === 0) return null;
  const a = matrix.map((row, i) => [...row.map(v => v / max), ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-12) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const div = a[k][k];
    for (let j = 0; j < 2 * n; j++) a[k][j] /= div;
    for (let i = 0; i < n; i++) if (i !== k) {
      const factor = a[i][k];
      for (let j = 0; j < 2 * n; j++) a[i][j] -= factor * a[k][j];
    }
  }
  const inv = a.map(row => row.slice(n).map(v => v / max));
  const matrixNorm = Math.max(...matrix.map(row => row.reduce((s, v) => s + Math.abs(v), 0)));
  const inverseNorm = Math.max(...inv.map(row => row.reduce((s, v) => s + Math.abs(v), 0)));
  if (matrixNorm * inverseNorm > 1e12 || inv.some(row => row.some(v => !Number.isFinite(v)))) return null;
  return inv;
}
export function positionAccuracy(measurements) {
  const groups = [...new Set(measurements.map(m => m.group))];
  const states = 3 + groups.length;
  const unavailable = reason => ({ valid: false, reason, satellites: measurements.length, groups, states, hrms: null, vrms: null, pdop: null });
  if (!groups.length || measurements.length < states) return unavailable('가시 위성 부족');
  const normal = Array.from({ length: states }, () => Array(states).fill(0));
  const geometry = Array.from({ length: states }, () => Array(states).fill(0));
  for (const m of measurements) {
    const row = [...m.losENU, ...groups.map(group => group === m.group ? 1 : 0)];
    const weight = 1 / (m.sigma * m.sigma);
    for (let i = 0; i < states; i++) for (let j = 0; j < states; j++) {
      normal[i][j] += row[i] * row[j] * weight;
      geometry[i][j] += row[i] * row[j];
    }
  }
  const cov = invert(normal), q = invert(geometry);
  if (!cov || !q || cov[0][0] < 0 || cov[1][1] < 0 || cov[2][2] < 0) return unavailable('위성 배치의 기하학적 제약');
  return { valid: true, reason: '', satellites: measurements.length, groups, states,
    hrms: Math.sqrt(cov[0][0] + cov[1][1]), vrms: Math.sqrt(cov[2][2]),
    pdop: Math.sqrt(q[0][0] + q[1][1] + q[2][2]), covariance: cov };
}
export function linkBudget(sat, config) {
  const fspl = 92.45 + 20 * Math.log10(config.frequency) + 20 * Math.log10(sat.range);
  const cn0=config.eirp+config.gt-fspl-config.rainLoss-config.otherLoss+228.6;
  const snr = cn0 - 10 * Math.log10(config.bandwidth * 1e6);
  const ebn0=cn0-10*Math.log10(config.dataRate*1e6);
  const efficiency = Math.min(6, Math.log2(1 + Math.pow(10, (snr - 3) / 10)));
  const navDuty = config.sharing === 'time' && sat.payload ? config.navShare / 100 : 0;
  const mbps = config.bandwidth * efficiency * 0.75 * (1 - navDuty);
  return { mbps, snr, fspl, cn0, ebn0, margin:ebn0-config.requiredEbn0, navDuty, delayMs: sat.range * 1e6 / C,
    dopplerKHz: sat.rangeRate === 0 ? 0 : -sat.rangeRate * 1000 / C * config.frequency * 1e6 };
}
export function snapshot(config, minutes = 0, constellation) {
  const cfg = validateConfig(config);
  return evaluateSnapshot(cfg, prepareGeometry(cfg, minutes, constellation));
}
// Orbit propagation and observer geometry do not depend on navigation time allocation.
export function prepareGeometry(cfg, minutes, constellation) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error('시각은 0–1440분 범위입니다.');
  const satList = constellation || buildConstellations(cfg), location = getLocation(cfg);
  const frame = observerFrame(location.lat, location.lon);
  const satellites = statesAt(satList,minutes).map(state => ({...state,...observe(state,frame)}));
  return { minutes, location, observer: frame.position, satellites };
}
export function statesAt(orbits,minutes) { return orbits.map(o=>({id:o.id,name:o.name||o.id,group:o.group,payload:o.payload,shell:o.shell,plane:o.plane,slot:o.slot,planes:o.planes,slots:o.slots,...orbitState(o,minutes*60)})); }
export function geometryAt(states,location,minutes) {const frame=observerFrame(location.lat,location.lon);return {minutes,location,observer:frame.position,satellites:states.map(s=>({...s,...observe(s,frame)}))};}
export function evaluateSnapshot(cfg, geometry) {
  const { minutes, location, observer } = geometry;
  const measurements = [], gnss = [], regional = [], leo = [], states = [];
  let best = null;
  let commVisible = 0, navVisibleLEO = 0, payloadCount = 0;
  for (const seen of geometry.satellites) {
    if (seen.group === 'LEO' && seen.payload) payloadCount++;
    const sat = { ...seen, sigma: null, navUsed: false };
    if (sat.group === 'LEO' && seen.elevation >= cfg.commElevation) {
      commVisible++;
      sat.link = linkBudget(sat, cfg);
      if (!best || sat.link.mbps > best.link.mbps) best = sat;
    }
    if (seen.elevation >= cfg.navElevation && sat.payload) {
      if (sat.group === 'LEO') {
        const fraction = cfg.sharing === 'time' ? cfg.navShare / 100 : 0.1;
        if (fraction > 0) {
          const noise = cfg.leoSigma * seen.range / 1000 * Math.sqrt(0.1 / fraction);
          sat.sigma = Math.sqrt(noise * noise + cfg.orbitSigma ** 2 + (cfg.clockNs * 1e-9 * C) ** 2);
          navVisibleLEO++;
        }
      } else sat.sigma = cfg.gnssSigma;
      if (sat.sigma !== null) {
        const m = { id: sat.id, group: sat.group, losENU: seen.losENU, sigma: sat.sigma };
        sat.navUsed = true;
        measurements.push(m);
        if (sat.group === 'GNSS') gnss.push(m);
        else if (sat.group === 'REGIONAL') regional.push(m);
        else leo.push(m);
      }
    }
    states.push(sat);
  }
  const baseline = positionAccuracy(gnss);
  const gnssLEO = positionAccuracy([...gnss, ...leo]);
  const fusion = positionAccuracy(measurements);
  const rate = best ? best.link.mbps : 0;
  const navPass = fusion.valid && fusion.hrms <= cfg.horizontalTarget;
  const commPass = rate >= cfg.rateTarget;
  return { minutes, satellites: states, observer, location, best,
    baseline, gnssLEO, fusion, rate, commVisible, navVisibleLEO, gnssVisible: gnss.length,
    regionalVisible: regional.length, payloadCount, navPass, commPass, jointPass: navPass && commPass };
}
export function compactSample(s) {
  const visible=s.satellites.filter(x=>x.group==='LEO' && x.link);
  const geometricBest=visible.reduce((a,b)=>!a||b.elevation>a.elevation?b:a,null);
  return { minutes: s.minutes, rate: s.rate, hrms: s.fusion.hrms, vrms:s.fusion.vrms, baseline: s.baseline.hrms,
    gnssLEO: s.gnssLEO.hrms, pdop: s.fusion.pdop, commVisible: s.commVisible,
    leoVisible: s.navVisibleLEO, gnssVisible: s.gnssVisible, regionalVisible: s.regionalVisible,
    geometricBestId:geometricBest?.id??null, bestId:s.best?.id??null,
    margin:s.best?.link.margin??null, snr:s.best?.link.snr??null, cn0:s.best?.link.cn0??null, ebn0:s.best?.link.ebn0??null, fspl:s.best?.link.fspl??null,
    dopplerKHz:s.best?.link.dopplerKHz??null, rangeKm:s.best?.range??null, elevation:s.best?.elevation??null,
    minDelayMs:visible.length?Math.min(...visible.map(v=>v.link.delayMs)):null,
    delayMs: s.best?.link.delayMs ?? null, navPass: s.navPass, commPass: s.commPass, jointPass: s.jointPass };
}
export function quantile(values, q) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const at = (valid.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return valid[lo] + (valid[hi] - valid[lo]) * (at - lo);
}
export function summarize(samples, config) {
  const count = samples.length, ratio = fn => count ? 100 * samples.filter(fn).length / count : 0;
  return { samples: count, stepMinutes: samples.length > 1 ? samples[1].minutes - samples[0].minutes : null,
    medianRate: quantile(samples.map(s => s.rate), .5), medianHrms: quantile(samples.map(s => s.hrms), .5),
    medianBaseline: quantile(samples.map(s => s.baseline), .5), medianGnssLEO: quantile(samples.map(s => s.gnssLEO), .5),
    commAvailability: ratio(s => s.commPass), navAvailability: ratio(s => s.navPass), jointAvailability: ratio(s => s.jointPass),
    baselineAvailability: ratio(s => s.baseline !== null && s.baseline <= config.horizontalTarget),
    gnssLeoAvailability: ratio(s => s.gnssLEO !== null && s.gnssLEO <= config.horizontalTarget),
    validNavAvailability: ratio(s => s.hrms !== null),
    minLEO: Math.min(...samples.map(s => s.leoVisible)), maxLEO: Math.max(...samples.map(s => s.leoVisible)) };
}
export function resourceSweep(config, minutes) {
  return parameterSweep(config, minutes, 'navShare');
}
// Ranges mirror validateConfig's own limits for each field.
const SWEEP_SPECS = {
  navShare: { min: 0, max: 40, steps: 21 },
  altitude: { min: 400, max: 2000, steps: 17 },
  inclination: { min: 0, max: 90, steps: 19 },
  planes: { min: 1, max: 32, steps: 32, integer: true },
  satellitesPerPlane: { min: 4, max: 32, steps: 15, integer: true },
  payloadPercent: { min: 0, max: 100, steps: 21 },
};
export const SWEEP_AXES = Object.keys(SWEEP_SPECS);
function sweepAxisPoints({ min, max, steps, integer }) {
  return Array.from({ length: steps }, (_, i) => {
    const raw = min + (max - min) * i / (steps - 1);
    return integer ? Math.round(raw) : Math.round(raw * 100) / 100;
  });
}
// Sweeps a single design variable across its full valid range, holding everything
// else fixed, so a trade study can compare e.g. altitude or plane count rather
// than only the original navigation-time-share axis. Points whose combination
// happens to be infeasible (e.g. planes × satellitesPerPlane > 512) are marked
// unavailable instead of aborting the whole sweep.
export function parameterSweep(config, minutes, axis = 'navShare') {
  const spec = SWEEP_SPECS[axis];
  if (!spec) throw new Error('지원하지 않는 스윕 변수: ' + axis);
  const base = axis === 'navShare' ? { ...validateConfig(config), sharing: 'time' } : validateConfig(config);
  // navShare alone doesn't change satellite geometry, so it can reuse one prepared geometry.
  const sharedGeometry = axis === 'navShare' ? prepareGeometry(base, minutes) : null;
  return sweepAxisPoints(spec).map(value => {
    try {
      const cfg = validateConfig({ ...base, [axis]: value });
      const geometry = sharedGeometry || prepareGeometry(cfg, minutes);
      const s = evaluateSnapshot(cfg, geometry);
      return { [axis]: value, rate: s.rate, hrms: s.fusion.hrms, unavailable: false };
    } catch {
      return { [axis]: value, rate: null, hrms: null, unavailable: true };
    }
  });
}
