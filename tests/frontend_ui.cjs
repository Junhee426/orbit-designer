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
].join(',');
const code = source.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/, `window.testAPI={${testExports}};\n})();`);
assert.notEqual(code, source, 'The harness must suppress the real startup call.');

function setup(controlOverrides = {}) {
  const elements = new Map();
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
        checked: checked.has(id), style: {}, className: '', children: [],
        setAttribute() {}, addEventListener() {}, click() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
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
    PolylineCollection: class { constructor() { this.items = []; } add(spec) { this.items.push(spec); cesiumCalls.push(['polyline', spec]); } },
    Material: { fromType: (type, opts) => ({ type, opts }) },
    Rectangle: { fromDegrees: (a, b, c, d) => ({ a, b, c, d }), MAX_VALUE: 'RECT_MAX' },
    ArcGisMapServerImageryProvider: { fromUrl: async (url, opts) => ({ tag: 'arcgis', url, opts }) },
    SingleTileImageryProvider: { fromUrl: async (url, opts) => ({ tag: 'single', url, opts }) },
    GeoJsonDataSource: { load: async (fc, opts) => ({ tag: 'geojson', fc, opts }) },
  };
  const entitiesAdded = [];
  const viewer = {
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
    window: {}, document, console, Cesium, AbortController,
    fetch: (url, options) => { requests.push({ url, options }); return requestImpl(url, options); },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
  });
  vm.runInContext(code, context);
  const api = context.window.testAPI;
  api.state.viewer = viewer;
  return {
    api, element, viewer, requests, cesiumCalls, entitiesAdded, Cesium,
    setFetch(fn) { requestImpl = fn; },
  };
}

async function run() {
  let checks = 0;

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
    h.setFetch(async url => ({ ok: true, json: async () => ({ coverage_summary: { worst_availability: 1 }, station_timelines: [] }) }));
    await h.api.runAnalysis();
    assert.deepEqual(h.requests.map(r => r.url), ['/api/multi-shell/simulate']);
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
