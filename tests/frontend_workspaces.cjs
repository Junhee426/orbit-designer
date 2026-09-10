const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const html = fs.readFileSync('app/static/index.html', 'utf8');
const application = fs.readFileSync('app/static/app.js', 'utf8');
assert(application.includes('function startPlayback'), 'The application script must be available to the behavior harness.');

// Keep the real navigation, request sequencing and summary rendering. Stub only
// GPU-backed scene operations so these checks also run without a browser.
const testExports = `window.testAPI = {
  state, setWorkspace, refreshPreview, renderOrbitSummary, invalidatePreview,
  snapshotPayload, bootstrap, invalidateAnalysis, runAnalysis, markServiceDirty,
  applyServiceSelection,
  stubScene() {
    renderCoverage = async () => {};
    reconcileSatellites = () => {};
    renderOrbits = () => {};
    renderIsl = () => {};
    renderAccess = () => {};
    fetchSelectedGeometry = async () => {};
  },
  stubStartup() {
    initShells = () => {};
    bind = () => {};
    bindRelease = () => {};
    loadServiceCatalog = async () => {};
    resolveServiceSelection = async () => {};
    loadCesium = async () => {};
    initViewer = async () => {};
    applyServiceSelection = async () => {};
    flyGlobal = () => {};
  }
};`;
const source = application.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/, `${testExports}\n})();`);
assert.notEqual(source, application, 'The harness must suppress the real startup call.');

function setup() {
  const elements = new Map();
  const requests = [];
  let frames = [];
  let pendingTimers = [];
  let nextTimer = 1;
  let selectedCodes = [];
  let requestImpl = async () => { throw new Error('Unexpected API request'); };
  const controls = {
    mode: 'walker', alt: '1280', inc: '42', planes: '8', spp: '16', phase: '1',
    j2: 'true', dur: '120', step: '60', speed: '20', minEl: '20', heatRes: '28',
    citiesPerCountry: '2', timeSlider: '0', boundaryMode: 'off', trackSpan: '220',
  };
  function element(id) {
    if (!elements.has(id)) {
      const attributes = new Map();
      const classes = new Set();
      elements.set(id, {
        id, value: controls[id] ?? '', textContent: '', innerHTML: '', disabled: false,
        checked: false, hidden: false, max: '7200', style: {}, dataset: {}, children: [],
        className: '', clientWidth: 1000, clientHeight: 600,
        classList: {
          add(...names) { names.forEach(name => classes.add(name)); },
          remove(...names) { names.forEach(name => classes.delete(name)); },
          contains(name) { return classes.has(name); },
          toggle(name, force) {
            const add = force ?? !classes.has(name);
            if (add) classes.add(name); else classes.delete(name);
            return add;
          },
        },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
        addEventListener() {}, focus() {}, scrollIntoView() {}, click() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const el = element(match[1]);
    el.checked = /\bchecked(?:\s|>|=)/.test(match[0]);
    for (const data of match[0].matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) {
      const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      el.dataset[key] = data[2];
    }
  }
  const querySelectorAll = selector => {
    if (selector === '.service-country:checked') return selectedCodes.map(value => ({ value }));
    if (selector === '.shell-card' || selector.includes('service-country')) return [];
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if (!data) return [];
    const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return [...elements.values()].filter(el => key in el.dataset &&
      (data[2] === undefined || el.dataset[key] === data[2]));
  };
  const document = {
    body: element('body'), documentElement: element('html'), getElementById: element,
    querySelectorAll, querySelector: selector => querySelectorAll(selector)[0] ?? null,
    addEventListener() {}, createElement: () => element('created'),
  };
  const viewer = {
    camera: { position: { x: 123, y: 456, z: 789 } },
    resizeCalls: 0, resize() { this.resizeCalls++; },
    scene: { requestRender() {}, primitives: { remove() {} } },
    entities: { remove() {} },
  };
  const window = { document, addEventListener() {}, location: { hash: '' } };
  const context = vm.createContext({
    window, document, console, AbortController, Blob, URL,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { const id = nextTimer++; pendingTimers.push({ id, fn, ms }); return id; },
    clearTimeout: id => { pendingTimers = pendingTimers.filter(timer => timer.id !== id); },
    Plotly: { purge() {}, react() {}, Plots: { resize() {} } },
    fetch: (url, options) => {
      requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      return requestImpl(url, options);
    },
  });
  vm.runInContext(source, context);
  const api = window.testAPI;
  api.state.viewer = viewer;
  api.stubScene();
  return {
    api, document, element, elements, requests, viewer,
    setFetch(fn) { requestImpl = fn; },
    selectCountries(codes) { selectedCodes = codes; },
    flushFrames() { const current = frames; frames = []; current.forEach(fn => fn()); },
  };
}

function snapshot() {
  return {
    mode: 'walker', time_sec: 0,
    satellites: [
      { id: 'W1', name: 'One', source: 'Walker', plane: 1, altitude_km: 600, period_min: 96 },
      { id: 'W2', name: 'Two', source: 'Walker', plane: 2, altitude_km: 1280, period_min: 112 },
      { id: 'W3', name: 'Three', source: 'Walker', plane: 2, altitude_km: 1280, period_min: 112 },
    ],
    visualization: {},
  };
}

async function run() {
  let checks = 0;

  // Navigation shares one scenario and must not silently start calculations.
  let h = setup();
  assert.equal(h.api.state.workspace, 'orbit');
  const analysis = { station_timelines: [{ name: 'Seoul', availability: 0.9 }] };
  const savedSnapshot = snapshot();
  h.api.state.analysis = analysis;
  h.api.state.snapshot = savedSnapshot;
  h.api.state.selectedId = 'W2';
  h.element('coverageOn').checked = true;
  const revision = h.api.state.revision;
  const camera = h.viewer.camera;
  for (const workspace of ['analysis', 'orbit', 'analysis']) {
    h.api.setWorkspace(workspace);
    h.flushFrames();
    assert.equal(h.document.body.dataset.workspace, workspace);
    assert.equal(h.api.state.workspace, workspace);
    assert.equal(h.api.state.analysis, analysis);
    assert.equal(h.api.state.snapshot, savedSnapshot);
    assert.equal(h.api.state.selectedId, 'W2');
    assert.equal(h.api.state.viewer.camera, camera);
    assert.equal(h.api.state.revision, revision);
    assert.equal(h.element('exportJsonBtn').disabled, false);
    assert.equal(h.element(`${workspace}Tab`).getAttribute('aria-current'), 'page');
    assert.equal(h.element(`${workspace === 'orbit' ? 'analysis' : 'orbit'}Tab`).getAttribute('aria-current'), null);
    assert.equal(h.api.snapshotPayload(0).heatmap, true);
  }
  assert.equal(h.requests.length, 0);
  checks++;

  // Preview metrics describe returned satellites, even when the form has 128.
  h = setup();
  h.element('kSat').textContent = '128';
  h.element('kAvail').textContent = '90%';
  h.api.renderOrbitSummary(snapshot());
  assert.equal(String(h.element('orbitSatCount').textContent), '3');
  assert.equal(String(h.element('orbitPlaneCount').textContent), '2');
  const periods = h.element('orbitPeriod').textContent.replaceAll(',', '');
  const altitudes = h.element('orbitAltitude').textContent.replaceAll(',', '');
  assert.match(periods, /96/);
  assert.match(periods, /112/);
  assert.match(altitudes, /600/);
  assert.match(altitudes, /1280/);
  assert.equal(h.element('kSat').textContent, '128');
  assert.equal(h.element('kAvail').textContent, '90%');
  assert.equal(h.api.state.previewDirty, false);
  checks++;

  // Preview freshness is separate from analysis data and export availability.
  h = setup();
  h.api.state.analysis = analysis;
  h.api.state.snapshot = savedSnapshot;
  h.api.renderOrbitSummary(savedSnapshot);
  const currentBadge = h.element('previewBadge').textContent;
  h.api.invalidatePreview();
  assert.equal(h.api.state.previewDirty, true);
  assert.notEqual(h.element('previewBadge').textContent, currentBadge);
  assert.equal(h.api.state.analysis, analysis);
  assert.equal(h.element('exportJsonBtn').disabled, false);
  assert.equal(h.requests.length, 0);
  checks++;

  // The clean initial globe does not request optional analysis overlays.
  h = setup();
  const payload = h.api.snapshotPayload(0);
  assert.equal(payload.include_orbits, true);
  assert.equal(payload.include_isl, false);
  assert.equal(payload.include_access, false);
  assert.equal(payload.heatmap, false);
  checks++;

  // Refreshing a layout only requests a snapshot and preserves analysis exports.
  h = setup();
  h.api.state.analysis = analysis;
  h.setFetch(async () => ({ ok: true, json: async () => snapshot() }));
  await h.api.refreshPreview();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/snapshot']);
  assert.equal(h.requests[0].body.altitude_km, 1280);
  assert.equal(h.api.state.snapshot.satellites.length, 3);
  assert.equal(h.api.state.analysis, analysis);
  assert.equal(h.element('exportJsonBtn').disabled, false);
  assert.equal(h.api.state.previewDirty, false);
  assert.equal(h.api.state.previewBusy, false);
  checks++;

  // A superseded response cannot replace the last accepted layout.
  h = setup();
  h.api.state.snapshot = savedSnapshot;
  let finish;
  h.setFetch(() => new Promise(resolve => { finish = resolve; }));
  const refresh = h.api.refreshPreview();
  assert.equal(h.requests.length, 1);
  h.element('alt').value = '900';
  h.api.invalidateAnalysis();
  h.api.invalidatePreview();
  finish({ ok: true, json: async () => ({ ...snapshot(), satellites: [] }) });
  await refresh;
  assert.equal(h.api.state.snapshot, savedSnapshot);
  assert.equal(h.api.state.analysis, null);
  assert.equal(h.element('exportJsonBtn').disabled, true);
  assert.equal(h.api.state.previewDirty, true);
  assert.equal(h.api.state.previewBusy, false);
  checks++;

  // Detailed analysis publishes its own results without refreshing the hidden map.
  h = setup();
  h.api.state.snapshot = savedSnapshot;
  h.api.renderOrbitSummary(savedSnapshot);
  h.api.setWorkspace('analysis');
  const result = {
    mode: 'walker', total_satellites: 128, orbital_period_min: 112,
    coverage_summary: { worst_availability: 0.9, mean_visible: 1.5 },
    station_timelines: [],
    analysis_metadata: {
      app_version: '1.2.0', input_sha256: 'test-fingerprint',
      inputs: { duration_min: 120, step_sec: 60 },
    },
  };
  h.setFetch(async () => ({ ok: true, json: async () => result }));
  await h.api.runAnalysis();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/simulate']);
  assert.equal(h.api.state.analysis, result);
  assert.equal(h.api.state.snapshot, savedSnapshot);
  assert.equal(h.api.state.previewDirty, false);
  assert.equal(h.element('orbitSatCount').textContent, '3');
  assert.equal(h.element('kAvail').textContent, '90.0%');
  assert.equal(h.element('analysisResults').hidden, false);
  assert.equal(h.element('exportJsonBtn').disabled, false);
  checks++;

  // Running directly after a country edit must use its resolved stations.
  h = setup();
  h.selectCountries(['JPN']);
  h.api.state.analysis = result;
  h.api.state.serviceSelection = {
    country_codes: ['KOR'],
    stations: [{ name: 'Seoul', lat_deg: 37.5665, lon_deg: 126.978 }],
  };
  const service = {
    country_codes: ['JPN'], countries: [{ code: 'JPN', name: 'Japan' }],
    stations: [{ name: 'Tokyo', lat_deg: 35.6762, lon_deg: 139.6503 }],
    coverage_areas: [],
  };
  h.api.markServiceDirty();
  assert.equal(h.api.state.analysis, null);
  assert.equal(h.element('servicePending').hidden, false);
  h.setFetch(async url => ({
    ok: true,
    json: async () => url === '/api/service-regions/resolve' ? service : result,
  }));
  await h.api.runAnalysis();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/service-regions/resolve', '/api/simulate']);
  assert.deepEqual(h.requests[0].body.country_codes, ['JPN']);
  assert.equal(h.requests[1].body.stations[0].name, 'Tokyo');
  assert.equal(h.api.state.serviceDirty, false);
  assert.equal(h.element('servicePending').hidden, true);
  checks++;

  // An unresolved service selection must not silently fall back to old stations.
  h = setup();
  h.api.markServiceDirty();
  h.setFetch(async () => ({ ok: false, json: async () => ({ detail: 'Select a country' }) }));
  await h.api.runAnalysis();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/service-regions/resolve']);
  assert.equal(h.api.state.analysis, null);
  assert.equal(h.api.state.serviceDirty, true);
  assert.equal(h.element('exportJsonBtn').disabled, true);
  assert.equal(h.api.state.analysisBusy, false);
  checks++;

  // Analysis clicked during automatic city/region application must resolve anew.
  h = setup();
  h.selectCountries(['JPN']);
  h.element('citiesPerCountry').value = '3';
  h.api.state.serviceSelection = {
    country_codes: ['KOR'],
    stations: [{ name: 'Seoul', lat_deg: 37.5665, lon_deg: 126.978 }],
  };
  let finishApply;
  let resolveCount = 0;
  h.setFetch(url => {
    if (url === '/api/service-regions/resolve' && resolveCount++ === 0) {
      return new Promise(resolve => { finishApply = resolve; });
    }
    return Promise.resolve({ ok: true, json: async () => url === '/api/service-regions/resolve' ? service : result });
  });
  const applying = h.api.applyServiceSelection(false);
  await h.api.runAnalysis();
  finishApply({ ok: true, json: async () => ({ ...service, country_codes: ['KOR'] }) });
  await applying;
  assert.deepEqual(h.requests.map(request => request.url), [
    '/api/service-regions/resolve', '/api/service-regions/resolve', '/api/simulate',
  ]);
  assert.equal(h.requests[1].body.cities_per_country, 3);
  assert.equal(h.requests[2].body.stations[0].name, 'Tokyo');
  assert.deepEqual(h.api.state.serviceSelection.country_codes, ['JPN']);
  assert.equal(h.api.state.analysis, result);
  checks++;

  // Startup displays the layout without running visibility or trade analysis.
  h = setup();
  h.api.stubStartup();
  h.setFetch(async () => ({ ok: true, json: async () => snapshot() }));
  await h.api.bootstrap();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/snapshot']);
  assert.equal(h.api.state.analysis, null);
  assert.equal(h.api.state.snapshot.satellites.length, 3);
  checks++;

  console.log(`${checks} workspace behavior checks passed`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
