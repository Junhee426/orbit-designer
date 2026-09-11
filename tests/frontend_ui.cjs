const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync('app/static/app.js', 'utf8');

// Behavior checks for functions that test_ui_contract.py used to pin by
// grepping exact (whitespace-sensitive) source text out of index.html.
// Reformatting app.js would silently break those checks, so this harness
// calls the real functions instead, the same way frontend_v12.cjs and
// frontend_workspaces.cjs already do.
const testExports = [
  'state', 'isEarthOccluded', 'updatePointOcclusion', 'reconcileSatellites',
  'updateSatelliteStyles', 'flyGlobal', 'GLOBAL_VIEW', 'SAT_MODELS',
  'applyEarthDisplay', 'applyEarthSource', 'renderOrbits', 'renderIsl',
  'renderAccess', 'flyServiceArea', 'pointInGeometry', 'ensureBoundaryData',
  'loadServiceCatalog', 'fetchSelectedGeometry', 'runAnalysis', 'setModeUI',
  'initShells', 'addShell', 'shellPayloads', 'snapshotPayload', 'bind',
  'selectNextServiceSatellite', 'sliderChanged',
].join(',');
const code = source.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/, `window.testAPI={${testExports}};\n})();`);
assert.notEqual(code, source, 'The harness must suppress the real startup call.');

function setup(controlOverrides = {}) {
  const elements = new Map();
  const cards = [];
  const requests = [];
  let requestImpl = async () => { throw new Error('Unexpected fetch call'); };
  const controls = {
    mode: 'walker', satRender: 'point', satSize: '1', satModel: 'default',
    earthOn: 'true', earthOpacity: '1', earthSource: 'offline',
    orbitOn: 'true', islOn: 'true', accessOn: 'true',
    groundTrackOn: 'false', footprintOn: 'false', trackSpan: '220',
    minEl: '20', timeSlider: '0', ...controlOverrides,
  };
  const checked = new Set(['earthOn', 'orbitOn', 'islOn', 'accessOn'].filter(k => controls[k] !== 'false'));
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: controls[id] ?? '', textContent: '', innerHTML: '', disabled: false,
        checked: checked.has(id), style: {}, dataset: {}, className: '', children: [],
        listeners: {}, attributes: {}, focused: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; }, removeAttribute(name) { delete this.attributes[name]; },
        addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); },
        click() { if (!this.disabled) for (const fn of this.listeners.click ?? []) fn(); },
        focus() { this.focused = true; },
        querySelector() { return null; }, querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  };
  element('shellList').appendChild = card => { cards.push(card); element('shellList').children = cards; };
  element('shellList').querySelector = selector => cards[0]?.querySelector(selector);
  function createCard() {
    const fields = new Map();
    return {
      dataset: {}, className: '',
      set innerHTML(html) {
        for (const match of html.matchAll(/<(input|select|button)\b([^>]*)>/g)) {
          const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
          const field = element(`card-${elements.size}-${attrs.class}`);
          field.attributes = attrs;
          field.tag = match[1];
          field.value = attrs.value ?? '';
          if (field.tag === 'select') field.value = /value="false" selected/.test(html) ? 'false' : 'true';
          field.checkValidity = () => attrs.type !== 'number' || (
            field.value.trim() !== '' && Number.isFinite(+field.value) &&
            +field.value >= +attrs.min && +field.value <= +attrs.max &&
            (attrs.step === 'any' || Number.isInteger(+field.value)));
          field.reportValidity = () => { field.reported = true; };
          fields.set(`.${attrs.class}`, field);
        }
        fields.set('.shell-total', { textContent: '' });
      },
      querySelector: selector => fields.get(selector),
      querySelectorAll: selector => [...fields.values()].filter(f => selector.split(',').includes(f.tag)),
      remove() { cards.splice(cards.indexOf(this), 1); },
    };
  }
  const document = {
    body: element('body'),
    getElementById: element,
    querySelectorAll: selector => selector === '.shell-card' ? cards : [],
    querySelector: () => null,
    addEventListener() {},
    createElement: tag => tag === 'div' ? createCard() : ({ style: {}, classList: { add() {}, remove() {} } }),
  };
  const cesiumCalls = [];
  const makeColor = tag => ({ tag, withAlpha(a) { return { ...this, alpha: a }; } });
  const Cesium = {
    Color: {
      WHITE: makeColor('WHITE'), CYAN: makeColor('CYAN'), YELLOW: makeColor('YELLOW'), LIME: makeColor('LIME'),
      fromCssColorString: s => makeColor(s),
    },
    Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Cartesian3: {
      fromElements: (x, y, z) => ({ x, y, z }),
      fromDegrees: (lon, lat, h) => ({ lon, lat, h }),
    },
    HeadingPitchRoll: class { constructor(h, p, r) { this.h = h; this.p = p; this.r = r; } },
    Transforms: { headingPitchRollQuaternion: (pos, hpr) => ({ pos, hpr }) },
    PolylineCollection: class {
      constructor() { this.items = []; }
      get length() { return this.items.length; }
      get(i) { return this.items[i]; }
      remove(line) { this.items.splice(this.items.indexOf(line), 1); }
      add(spec) { this.items.push(spec); cesiumCalls.push(['polyline', spec]); return spec; }
    },
    Material: { fromType: (type, opts) => ({ type, opts, uniforms: opts }) },
    HeadingPitchRange: class {}, Math: { toRadians: x => x * Math.PI / 180 },
    Rectangle: { fromDegrees: (a, b, c, d) => ({ a, b, c, d }), MAX_VALUE: 'RECT_MAX' },
    ArcGisMapServerImageryProvider: { fromUrl: async (url, opts) => ({ tag: 'arcgis', url, opts }) },
    SingleTileImageryProvider: { fromUrl: async (url, opts) => ({ tag: 'single', url, opts }) },
    GeoJsonDataSource: { load: async (fc, opts) => ({ tag: 'geojson', fc, opts }) },
  };
  const entitiesAdded = [];
  const viewer = {
    flyTo(entity) { cesiumCalls.push(['flyToEntity', entity]); },
    camera: {
      positionWC: { x: 3 * 6378137.0, y: 0, z: 0 },
      setView(opts) { cesiumCalls.push(['setView', opts]); },
      flyTo(opts) { cesiumCalls.push(['flyTo', opts]); },
    },
    scene: {
      globe: { translucency: {} },
      primitives: { add: c => c, remove() {} },
    },
    entities: {
      add(opts) { entitiesAdded.push(opts); return { ...opts }; },
      remove() {},
    },
    imageryLayers: {
      addImageryProvider(provider, index) { return { provider, index, alpha: 1 }; },
      remove() {},
    },
    dataSources: { add: async ds => ds, remove() {} },
  };
  const context = vm.createContext({
    window: {}, document, console, Cesium, AbortController, requestAnimationFrame() {},
    fetch: (url, options) => { requests.push({ url, options }); return requestImpl(url, options); },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
  });
  vm.runInContext(code, context);
  const api = context.window.testAPI;
  api.state.viewer = viewer;
  return {
    api, element, viewer, requests, cesiumCalls, entitiesAdded, Cesium, cards,
    setFetch(fn) { requestImpl = fn; },
  };
}

async function run() {
  let checks = 0;

  // Stable layers retain their line/material objects over 120 playback updates.
  {
    const h = setup();
    const makeLinks = (frame, count) => Array.from({ length: count }, (_, i) => ({
      a_ecef_km: [7000, i, frame], b_ecef_km: [7100, i + 1, frame],
    }));
    h.api.renderIsl({ isl_links: makeLinks(0, 512) });
    const collection = h.api.state.islCollection;
    const first = collection.get(0), material = first.material;
    for (let frame = 1; frame < 120; frame++) h.api.renderIsl({ isl_links: makeLinks(frame, 512) });
    assert.equal(h.api.state.islCollection, collection);
    assert.equal(collection.get(0), first);
    assert.equal(first.material, material);
    assert.equal(first.positions[0].z, 119000);
    assert.equal(h.cesiumCalls.filter(x => x[0] === 'polyline').length, 512);
    h.api.renderIsl({ isl_links: makeLinks(120, 2) });
    assert.equal(collection.length, 2);
    h.api.renderIsl({ isl_links: makeLinks(121, 3) });
    assert.equal(collection.length, 3);
    h.api.renderIsl({ isl_links: [] });
    assert.equal(h.api.state.islCollection, null);
    console.log('512 links × 120 updates: 512 line creations (previously 61,440)');
    checks++;
  }

  // Service-only is local, applies to both render modes and follows new snapshots.
  {
    const h = setup();
    const sat = (id, active) => ({ id, name: id, source: 'Walker', ecef_x_km: 7500, ecef_y_km: 0, ecef_z_km: 0,
      service_visible: active, service_station_count: active ? 1 : 0 });
    const satellites = [sat('A', true), sat('B', false), sat('C', true)];
    h.api.state.snapshot = { satellites };
    h.api.reconcileSatellites(satellites);
    h.element('serviceOnly').checked = true;
    h.api.updateSatelliteStyles();
    assert.equal(h.api.state.satEntities.get('B').show, false);
    assert.equal(h.api.state.satEntities.get('A').show, true);
    h.element('satRender').value = 'model';
    h.api.updateSatelliteStyles();
    assert.equal(h.api.state.satEntities.get('B').show, false);
    h.api.selectNextServiceSatellite();
    assert.equal(h.api.state.selectedId, 'A');
    h.api.selectNextServiceSatellite();
    assert.equal(h.api.state.selectedId, 'C');
    h.api.selectNextServiceSatellite();
    assert.equal(h.api.state.selectedId, 'A');
    assert.equal(h.cesiumCalls.filter(x => x[0] === 'flyToEntity').length, 3);
    satellites[0].service_visible = false;
    satellites[2].service_visible = false;
    h.api.reconcileSatellites(satellites);
    assert.equal(h.api.state.satEntities.get('A').show, false);
    assert.equal(h.element('nextServiceSatellite').disabled, true);
    h.api.selectNextServiceSatellite();
    assert.equal(h.cesiumCalls.filter(x => x[0] === 'flyToEntity').length, 3);
    h.element('serviceOnly').checked = false;
    h.api.updateSatelliteStyles();
    assert.equal(h.api.state.satEntities.get('B').show, true);
    assert.equal(h.requests.length, 0);
    checks++;
  }

  // Dragging invalidates an old response before the debounce expires.
  {
    const h = setup();
    const controller = new AbortController();
    h.api.state.snapshotController = controller;
    const seq = h.api.state.snapshotSeq;
    h.api.sliderChanged();
    assert.equal(controller.signal.aborted, true);
    assert.equal(h.api.state.snapshotSeq, seq + 1);
    clearTimeout(h.api.state.sliderDebounce);
    checks++;
  }

  // Service highlighting survives layer/style changes and updates in place with time.
  {
    const h = setup({ accessOn: 'false' });
    const sat = (id, active) => ({ id, name: id, ecef_x_km: 7500, ecef_y_km: 0, ecef_z_km: 0, service_visible: active });
    h.api.reconcileSatellites([sat('A', true), sat('B', false)]);
    const a = h.api.state.satEntities.get('A'), b = h.api.state.satEntities.get('B');
    assert.ok(a.point.pixelSize > b.point.pixelSize);
    assert.equal(b.point.color.alpha, .45);
    assert.equal(h.element('serviceVisibleCount').textContent, '1 / 2기');
    h.element('satRender').value = 'model';
    h.element('satSize').value = '2';
    h.api.updateSatelliteStyles();
    assert.ok(a.model.minimumPixelSize > b.model.minimumPixelSize);
    assert.equal(a.model.silhouetteSize, 1.5);
    h.api.state.selectedId = 'B';
    h.api.updateSatelliteStyles();
    assert.equal(b.point.color.tag, h.Cesium.Color.YELLOW.tag);
    h.api.state.selectedId = null;
    h.api.reconcileSatellites([sat('A', false), sat('B', true)]);
    assert.equal(h.api.state.satEntities.get('A'), a);
    assert.ok(b.point.pixelSize > a.point.pixelSize);
    assert.equal(a.model.silhouetteSize, 0);
    h.api.reconcileSatellites([sat('A', false)]);
    assert.equal(h.element('serviceVisibleCount').textContent, '0 / 1기');
    assert.equal(h.api.state.satEntities.has('B'), false);
    checks++;
  }

  // 1. Satellite point markers must render through Earth (disableDepthTestDistance:0),
  //    not force through it (Number.POSITIVE_INFINITY), and carry no outline.
  {
    const h = setup();
    h.api.reconcileSatellites([{ id: 'A', name: 'A', ecef_x_km: 1000, ecef_y_km: 0, ecef_z_km: 0 }]);
    const e = h.api.state.satEntities.get('A');
    assert.equal(e.point.disableDepthTestDistance, 0);
    assert.equal(e.label.disableDepthTestDistance, 0);
    assert.equal('outlineColor' in e.point, false);
    assert.equal('outlineWidth' in e.point, false);
    checks++;
  }

  // 2. The model-render dropdown is wired: selecting a model swaps e.model.uri
  //    and is only enabled in model-render mode.
  {
    const h = setup({ satRender: 'model', satModel: 'compact' });
    const fake = { model: {}, point: {}, label: {} };
    h.api.state.satEntities.set('A', fake);
    h.api.updateSatelliteStyles();
    assert.equal(fake.model.uri, h.api.SAT_MODELS.compact);
    assert.match(h.api.SAT_MODELS.default, /kleo_satellite\.glb$/);
    assert.match(h.api.SAT_MODELS.compact, /kleo_satellite_compact\.glb$/);
    assert.match(h.api.SAT_MODELS.broadband, /kleo_satellite_broadband\.glb$/);
    assert.match(h.api.SAT_MODELS.flatpanel, /kleo_satellite_flatpanel\.glb$/);
    assert.equal(h.element('satModel').disabled, false);
    h.element('satRender').value = 'point';
    h.api.updateSatelliteStyles();
    assert.equal(h.element('satModel').disabled, true);
    checks++;
  }

  // 3. isEarthOccluded gates point/label visibility only while earthOn is checked.
  {
    const h = setup({ earthOn: 'true', satRender: 'point' });
    const R = 6378137.0;
    h.viewer.camera.positionWC = { x: 3 * R, y: 0, z: 0 };
    const front = { model: {}, point: {}, label: {}, _kleoPosition: { x: 1.14 * R, y: 0, z: 0 } };
    const back = { model: {}, point: {}, label: {}, _kleoPosition: { x: -1.14 * R, y: 0, z: 0 } };
    h.api.state.satEntities.set('front', front);
    h.api.state.satEntities.set('back', back);
    h.api.updatePointOcclusion();
    assert.equal(front.point.show, true);
    assert.equal(back.point.show, false, 'a satellite behind Earth must not render as a point');
    h.element('earthOn').checked = false;
    h.api.updatePointOcclusion();
    assert.equal(back.point.show, true, 'Earth-off must disable horizon occlusion');
    checks++;
  }

  // 4. The global initial camera view uses the documented GLOBAL_VIEW constant,
  //    and instant vs. animated framing calls the matching Cesium camera method.
  {
    const h = setup();
    assert.equal(h.api.GLOBAL_VIEW.lon, 100);
    assert.equal(h.api.GLOBAL_VIEW.lat, 20);
    assert.equal(h.api.GLOBAL_VIEW.height, 24000000);
    h.api.flyGlobal(true);
    assert.equal(h.cesiumCalls.length, 1);
    assert.equal(h.cesiumCalls[0][0], 'setView');
    assert.equal(h.cesiumCalls[0][1].destination.lon, 100);
    assert.equal(h.cesiumCalls[0][1].destination.lat, 20);
    assert.equal(h.cesiumCalls[0][1].destination.h, 24000000);
    h.cesiumCalls.length = 0;
    h.api.flyGlobal(false);
    assert.equal(h.cesiumCalls[0][0], 'flyTo');
    assert.equal(h.cesiumCalls[0][1].duration, 0.8);
    checks++;
  }

  // 5. Earth opacity drives globe translucency, not a boolean on/off toggle.
  {
    const h = setup({ earthOn: 'true', earthOpacity: '0.5' });
    h.api.applyEarthDisplay();
    const g = h.viewer.scene.globe;
    assert.equal(g.show, true);
    assert.equal(g.translucency.enabled, true);
    assert.equal(g.translucency.frontFaceAlpha, 0.5);
    assert.equal(g.translucency.backFaceAlpha, 0.5);
    h.element('earthOpacity').value = '1';
    h.api.applyEarthDisplay();
    assert.equal(g.translucency.enabled, false, 'fully opaque globe must disable translucency');
    checks++;
  }

  // 6. Earth imagery source selects the matching Cesium provider, and an
  //    online failure falls back to the offline Blue Marble layer.
  {
    const h = setup({ earthSource: 'online' });
    await h.api.applyEarthSource();
    assert.equal(h.api.state.baseLayer.provider.tag, 'arcgis');

    const h2 = setup({ earthSource: 'offline' });
    await h2.api.applyEarthSource();
    assert.equal(h2.api.state.baseLayer.provider.tag, 'single');
    assert.equal(h2.api.state.baseLayer.provider.opts.rectangle, 'RECT_MAX');

    const h3 = setup({ earthSource: 'online' });
    h3.Cesium.ArcGisMapServerImageryProvider.fromUrl = async () => { throw new Error('network down'); };
    await h3.api.applyEarthSource();
    assert.equal(h3.element('earthSource').value, 'offline', 'a failed online layer must fall back to offline');
    assert.equal(h3.api.state.baseLayer.provider.tag, 'single');
    checks++;
  }

  // 7. Orbit/ISL/access polylines are only built while their layer toggle is on.
  {
    const h = setup({ orbitOn: 'true' });
    const viz = { orbits: [{ id: 'o1', ecef_km: [[1, 2, 3], [4, 5, 6]] }] };
    h.api.renderOrbits(viz);
    assert.equal(h.api.state.orbitCollection.items.length, 1);
    h.element('orbitOn').checked = false;
    h.api.renderOrbits(viz);
    assert.equal(h.api.state.orbitCollection, null, 'layer toggled off must not keep a stale collection');
    checks++;
  }
  {
    const h = setup({ islOn: 'true' });
    const viz = { isl_links: [{ a_ecef_km: [1, 2, 3], b_ecef_km: [4, 5, 6] }] };
    h.api.renderIsl(viz);
    assert.equal(h.api.state.islCollection.items.length, 1);
    h.element('islOn').checked = false;
    h.api.renderIsl(viz);
    assert.equal(h.api.state.islCollection, null);
    checks++;
  }
  {
    const h = setup({ accessOn: 'true' });
    const viz = { access_links: [{ station: 'Seoul', station_lat_deg: 37, station_lon_deg: 127, station_ecef_km: [1, 2, 3], satellite_ecef_km: [4, 5, 6], visible: true }] };
    h.api.renderAccess(viz);
    assert.equal(h.api.state.accessCollection.items.length, 1);
    assert.equal(h.entitiesAdded.length, 1, 'a visible access link must create the ground station marker');
    checks++;
  }

  // 8. Applying a service area flies the camera to its resolved bounds.
  {
    const h = setup();
    h.api.state.serviceSelection = { camera_bounds: { lon_min: 1, lat_min: 2, lon_max: 3, lat_max: 4 } };
    h.api.flyServiceArea();
    assert.equal(h.cesiumCalls.length, 1);
    assert.equal(h.cesiumCalls[0][0], 'flyTo');
    assert.deepEqual(h.cesiumCalls[0][1].destination, { a: 1, b: 2, c: 3, d: 4 });
    assert.equal(h.cesiumCalls[0][1].duration, 0.9);
    checks++;
  }

  // 9. The heat-map country mask is a real point-in-polygon test, not a bounding box.
  {
    const h = setup();
    const square = { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] };
    assert.equal(h.api.pointInGeometry(5, 5, square), true);
    assert.equal(h.api.pointInGeometry(50, 50, square), false);
    assert.equal(h.api.pointInGeometry(5, 5, null), true, 'no boundary geometry must not hide the heat-map');
    checks++;
  }

  // 10. Boundary data prefers the local Natural Earth file, then the remote
  //     copy, then the bundled bbox fallback -- and labels whichever it used.
  {
    const h = setup();
    h.api.state.serviceCatalog = {
      boundary_local_available: true,
      boundary_local_url: 'local.json', boundary_remote_url: 'remote.json', boundary_fallback_url: 'fallback.json',
    };
    h.setFetch(async () => ({ ok: true, json: async () => ({ features: [] }) }));
    await h.api.ensureBoundaryData();
    assert.equal(h.api.state.boundarySource, 'Natural Earth 50m · local');
    checks++;
  }
  {
    const h = setup();
    h.api.state.serviceCatalog = {
      boundary_local_available: false,
      boundary_remote_url: 'remote.json', boundary_fallback_url: 'fallback.json',
    };
    h.setFetch(async () => ({ ok: true, json: async () => ({ features: [] }) }));
    await h.api.ensureBoundaryData();
    assert.equal(h.api.state.boundarySource, 'Natural Earth 50m · online');
    checks++;
  }
  {
    const h = setup();
    h.api.state.serviceCatalog = {
      boundary_local_available: false,
      boundary_remote_url: 'remote.json', boundary_fallback_url: 'fallback.json',
    };
    h.setFetch(async url => url === 'fallback.json'
      ? { ok: true, json: async () => ({ features: [] }) }
      : { ok: false, json: async () => ({}) });
    await h.api.ensureBoundaryData();
    assert.equal(h.api.state.boundarySource, 'BBox fallback');
    checks++;
  }

  // 11. The service-region catalog is fetched from the documented endpoint.
  {
    const h = setup();
    h.setFetch(async () => ({ ok: true, json: async () => ({ regions: [], countries: [] }) }));
    await h.api.loadServiceCatalog();
    assert.deepEqual(h.requests.map(r => r.url), ['/api/service-regions/catalog']);
    checks++;
  }

  // 12. Selecting a satellite requests its ground track / footprint from the
  //     documented per-satellite geometry endpoint.
  {
    const h = setup({ groundTrackOn: 'true' });
    h.api.state.selectedId = 'W1';
    h.setFetch(async (url, options) => {
      assert.equal(url, '/api/orbital-geometry');
      assert.equal(JSON.parse(options.body).satellite_id, 'W1');
      return { ok: true, json: async () => ({}) };
    });
    await h.api.fetchSelectedGeometry();
    checks++;
  }

  // 13. Multi-shell mode runs analysis against the multi-shell endpoint.
  {
    const h = setup({ mode: 'multi_shell' });
    h.api.initShells();
    h.setFetch(async url => ({ ok: true, json: async () => ({ coverage_summary: { worst_availability: 1 }, station_timelines: [] }) }));
    await h.api.runAnalysis();
    assert.deepEqual(h.requests.map(r => r.url), ['/api/multi-shell/simulate']);
    checks++;
  }

  // Layer editor actions preserve parameters and IDs through preview and analysis.
  {
    const h = setup({ mode: 'walker' });
    h.api.initShells();
    h.api.bind();
    h.element('openMultiShellBtn').click();
    assert.equal(h.element('mode').value, 'multi_shell');
    assert.equal(h.element('multiShellFields').style.display, 'block');
    assert.equal(h.element('settingsPanel').dataset.expanded, 'true');
    assert.equal(h.element('shellSummary').textContent, '2개 궤도층 · 총 200기');
    const first = h.cards[0];
    first.querySelector('.sh-alt').value = '888.5';
    first.querySelector('.sh-j2').value = 'false';
    first.querySelector('.sh-copy').click();
    assert.equal(h.cards.length, 3);
    assert.equal(h.cards[2].dataset.shellId, 'SH3');
    assert.equal(h.api.shellPayloads(true)[2].altitude_km, 888.5);
    assert.equal(h.api.shellPayloads(true)[2].j2, false);
    assert.equal(h.api.state.previewDirty, true);
    const snapshot = h.api.snapshotPayload(60);
    assert.equal(snapshot.mode, 'multi_shell');
    assert.equal(snapshot.shells.length, 3);
    h.setFetch(async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).shells, JSON.parse(JSON.stringify(snapshot.shells)));
      return { ok: false, json: async () => ({ detail: 'test response' }) };
    });
    await h.api.runAnalysis();
    assert.equal(h.requests[0].url, '/api/multi-shell/simulate');
    h.cards[1].querySelector('.sh-remove').click();
    h.element('addShellBtn').click();
    assert.equal(h.cards[2].dataset.shellId, 'SH2', 'Deleted IDs can be reused without duplicates');
    while (h.cards.length > 1) h.cards[1].querySelector('.sh-remove').click();
    assert.equal(first.querySelector('.sh-remove').disabled, true);
    first.querySelector('.sh-remove').click();
    assert.equal(h.cards.length, 1);
    checks++;
  }

  // Invalid layer fields cannot issue an analysis request and focus the offending field.
  for (const [selector, value] of [['.sh-alt', ''], ['.sh-inc', '181'], ['.sh-planes', '1.5'], ['.sh-phase', '-1']]) {
    const h = setup({ mode: 'multi_shell' });
    h.api.initShells();
    const input = h.cards[0].querySelector(selector);
    input.value = value;
    await h.api.runAnalysis();
    assert.equal(h.requests.length, 0);
    assert.equal(input.focused, true);
    assert.equal(input.reported, true);
    assert.match(h.element('status').textContent, /입력값을 확인/);
    checks++;
  }

  // 14. Switching mode gates the trade-study button to walker-only and TLE-only geometry toggles.
  {
    const h = setup({ mode: 'walker' });
    h.api.setModeUI();
    assert.equal(h.element('tradeBtn').disabled, false);
    assert.equal(h.element('groundTrackOn').disabled, false);
    h.element('mode').value = 'tle';
    h.api.setModeUI();
    assert.equal(h.element('tradeBtn').disabled, true, 'trade-study compares Walker candidates only');
    assert.equal(h.element('groundTrackOn').disabled, true, 'TLE mode has no per-satellite ground track endpoint');
    assert.equal(h.element('footprintOn').disabled, true);
    h.element('mode').value = 'multi_shell';
    h.api.setModeUI();
    assert.equal(h.element('tradeBtn').disabled, true);
    assert.equal(h.element('groundTrackOn').disabled, false);
    checks++;
  }

  console.log(`${checks} UI behavior checks passed`);
}

run().catch(e => { console.error(e); process.exitCode = 1; });
