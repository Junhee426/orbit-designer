(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  const CVER = '1.144';
  const CDN_BASE = `https://cesium.com/downloads/cesiumjs/releases/${CVER}/Build/Cesium/`;
  const LOCAL_BASE = '/static/vendor/cesium/';
  const OFFLINE_EARTH = '/static/earth_blue_marble_2048.jpg';
  const SAT_MODELS = {
    default: '/static/kleo_satellite.glb',
    compact: '/static/kleo_satellite_compact.glb',
    broadband: '/static/kleo_satellite_broadband.glb',
    flatpanel: '/static/kleo_satellite_flatpanel.glb'
  };
  const SHELL_COLORS = ['#5db8ff', '#ff9f43', '#a78bfa', '#64d6a2', '#ff6b8a', '#ffd166'];

  function shellColor(id, alpha = 1) {
    if (!id) return Cesium.Color.WHITE.withAlpha(alpha);
    const m = String(id).match(/(\d+)/),
      i = m ? Math.max(0, (+m[1] - 1) % SHELL_COLORS.length) : 0;
    return Cesium.Color.fromCssColorString(SHELL_COLORS[i]).withAlpha(alpha)
  };
  const ARCGIS = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const verificationTLE = `VANGUARD 1\n1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667`;
  const DEFAULT_SHELLS = [{
      id: 'SH1',
      name: 'Core 1280 km',
      altitude_km: 1280,
      inclination_deg: 42,
      planes: 8,
      sats_per_plane: 16,
      phasing: 1,
      j2: true
    },
    {
      id: 'SH2',
      name: 'High-inclination supplement',
      altitude_km: 600,
      inclination_deg: 70,
      planes: 6,
      sats_per_plane: 12,
      phasing: 1,
      j2: true
    }
  ];

  function shellCardData(card) {
    return {
      id: card.dataset.shellId,
      name: card.querySelector('.sh-name').value || card.dataset.shellId,
      altitude_km: +card.querySelector('.sh-alt').value,
      inclination_deg: +card.querySelector('.sh-inc').value,
      planes: +card.querySelector('.sh-planes').value,
      sats_per_plane: +card.querySelector('.sh-spp').value,
      phasing: +card.querySelector('.sh-phase').value,
      j2: card.querySelector('.sh-j2').value === 'true'
    }
  }

  function shellPayloads() {
    return [...document.querySelectorAll('.shell-card')].map(shellCardData)
  }

  function updateShellSummary() {
    const shells = shellPayloads(),
      total = shells.reduce((a, x) => a + x.planes * x.sats_per_plane, 0);
    $('shellSummary').textContent = `${shells.length} shell(s) · ${total} satellites`;
    for (const c of document.querySelectorAll('.shell-card')) {
      const d = shellCardData(c),
        e = c.querySelector('.shell-total');
      if (e) e.textContent = `${d.planes} × ${d.sats_per_plane} = ${d.planes*d.sats_per_plane} satellites`
    }
  }

  function addShell(shell = {}) {
    const idx = document.querySelectorAll('.shell-card').length + 1,
      used = new Set([...document.querySelectorAll('.shell-card')].map(x => x.dataset.shellId));
    let n = 1;
    while (used.has(`SH${n}`)) n++;
    const id = shell.id || `SH${n}`,
      card = document.createElement('div');
    card.className = 'shell-card';
    card.dataset.shellId = id;
    card.innerHTML = `<div class="shell-card-head"><input class="sh-name" value="${esc(shell.name||`Shell ${idx}`)}" aria-label="shell name"><button class="sh-remove" type="button">삭제</button></div><div class="row"><div class="field"><label>고도 · km</label><input class="sh-alt" type="number" min="160" max="3000" value="${shell.altitude_km??1280}"></div><div class="field"><label>경사각 · °</label><input class="sh-inc" type="number" min="0" max="180" step="0.1" value="${shell.inclination_deg??42}"></div></div><div class="row"><div class="field"><label>궤도면 수</label><input class="sh-planes" type="number" min="1" max="128" value="${shell.planes??8}"></div><div class="field"><label>궤도면당 위성 수</label><input class="sh-spp" type="number" min="1" max="256" value="${shell.sats_per_plane??16}"></div></div><div class="row"><div class="field"><label>Walker F</label><input class="sh-phase" type="number" value="${shell.phasing??1}"></div><div class="field"><label>J2 RAAN drift</label><select class="sh-j2"><option value="true" ${(shell.j2??true)?'selected':''}>On</option><option value="false" ${shell.j2===false?'selected':''}>Off</option></select></div></div><div class="shell-total"></div>`;
    card.querySelector('.sh-remove').addEventListener('click', () => {
      card.remove();
      updateShellSummary()
    });
    for (const e of card.querySelectorAll('input,select')) e.addEventListener('change', updateShellSummary);
    $('shellList').appendChild(card);
    updateShellSummary()
  }

  function initShells() {
    if (!$('shellList').children.length)
      for (const sh of DEFAULT_SHELLS) addShell(sh)
  }
  const state = {
    workspace: 'orbit',
    previewDirty: true,
    previewBusy: false,
    viewer: null,
    snapshot: null,
    selectedId: null,
    satEntities: new Map(),
    groundEntities: new Map(),
    orbitCollection: null,
    islCollection: null,
    accessCollection: null,
    groundTrackCollection: null,
    footprintEntity: null,
    geometrySeq: 0,
    coverageLayers: [],
    baseLayer: null,
    boundaryDataSource: null,
    boundaryData: null,
    boundaryFallback: null,
    boundaryFeatureMap: new Map(),
    boundarySource: null,
    serviceCatalog: null,
    serviceSelection: null,
    playing: false,
    timer: null,
    snapshotSeq: 0,
    sliderDebounce: null,
    cesiumSource: null,
    revision: 0,
    analysis: null,
    analysisBusy: false,
    snapshotController: null,
    playbackGeneration: 0
  };

  function setWorkspace(view) {
    if (!['orbit', 'analysis'].includes(view)) return;
    state.workspace = view;
    document.body.dataset.workspace = view;
    stopPlayback();
    for (const name of ['orbit', 'analysis']) {
      const tab = $(name + 'Tab');
      if (name === view) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    const analysis = view === 'analysis';
    $('workspaceTitle').textContent = analysis ? '상세 분석' : '궤도 배치';
    $('workspaceEyebrow').textContent = analysis ? 'VISIBILITY ANALYSIS' : 'CONSTELLATION OVERVIEW';
    $('workspaceDescription').textContent = analysis ? '관측 도시의 가시성을 계산하고 위성군 후보를 비교하세요.' : '위성군의 구성과 움직임을 한눈에 확인하세요.';
    $('timeSettings').open = analysis;
    updateAnalysisConfig();
    setSettingsExpanded(false);
    requestAnimationFrame(() => {
      if (state.workspace !== view) return;
      if (analysis) {
        if (state.analysis?.station_timelines && typeof Plotly !== 'undefined') Plotly.Plots.resize($('coverage'));
      } else {
        state.viewer?.resize();
        state.viewer?.scene.requestRender();
      }
    });
  }

  function setSettingsExpanded(expanded) {
    $('settingsPanel').dataset.expanded = String(expanded);
    $('settingsToggle').setAttribute('aria-expanded', String(expanded));
    $('settingsToggle').textContent = expanded ? '설정 접기 −' : '설정 펼치기 ＋';
  }

  function updateAnalysisConfig() {
    if (mode() === 'walker') $('analysisConfig').textContent = `Walker-Delta · ${$('alt').value} km · 경사각 ${$('inc').value}° · ${$('planes').value}개 궤도면 × ${$('spp').value}기`;
    else if (mode() === 'multi_shell') {
      const shells = shellPayloads();
      $('analysisConfig').textContent = `Multi-shell · ${shells.length}개 shell · 총 ${shells.reduce((n,s)=>n+s.planes*s.sats_per_plane,0)}기`;
    } else $('analysisConfig').textContent = 'TLE / SGP4 · 입력한 TLE 데이터 기준';
  }

  function invalidatePreview() {
    state.previewDirty = true;
    $('previewBadge').textContent = '변경 사항 미반영';
    $('previewBadge').className = 'badge pending';
    $('previewNotice').textContent = state.snapshot ? '지도와 요약은 이전 배치입니다. «궤도 배치 적용»을 눌러 갱신하세요.' : '«궤도 배치 적용»을 눌러 위성군을 확인하세요.';
    if (state.snapshot) setStatus('궤도 설정이 변경되었습니다. 배치를 적용해 지도를 갱신하세요.', 'warn');
    updateAnalysisConfig();
  }

  function renderOrbitSummary(snap) {
    const sats = snap.satellites || [];
    const range = (key, digits) => {
      const values = sats.map(s => s[key]).filter(v => v !== null && v !== undefined && Number.isFinite(+v)).map(Number);
      if (!values.length) return '–';
      const low = Math.min(...values),
        high = Math.max(...values);
      return num(low, digits) + (high - low >= Math.pow(10, -digits) ? ' – ' + num(high, digits) : '');
    };
    $('orbitSatCount').textContent = sats.length.toLocaleString('ko-KR');
    $('orbitPlaneCount').textContent = snap.mode === 'tle' ? '해당 없음' : new Set(sats.filter(s => s.plane != null).map(s => `${s.shell_id||''}:${s.plane}`)).size.toLocaleString('ko-KR');
    $('orbitAltitude').textContent = range('altitude_km', 0);
    $('orbitPeriod').textContent = range('period_min', 1);
    state.previewDirty = false;
    $('previewBadge').textContent = '배치 적용됨';
    $('previewBadge').className = 'badge';
    $('previewNotice').textContent = `${fmtTime(snap.time_sec)} 기준 · ${snap.mode==='tle'?'TLE / SGP4':snap.mode==='multi_shell'?'Multi-shell Walker':'Walker-Delta'} · 지도를 드래그해 회전하고 스크롤로 확대하세요.`;
  }
  async function refreshPreview() {
    if (state.previewBusy || !state.viewer) return false;
    stopPlayback();
    state.previewBusy = true;
    $('previewBtn').disabled = true;
    $('previewBtn').textContent = '배치 적용 중…';
    try {
      return await fetchSnapshot(+$('timeSlider').value || 0);
    } finally {
      state.previewBusy = false;
      $('previewBtn').disabled = !state.viewer;
      $('previewBtn').textContent = '궤도 배치 적용';
    }
  }

  function showAnalysisResults(comparison = false) {
    $('analysisEmpty').hidden = true;
    $('analysisResults').hidden = false;
    $('metricsCard').hidden = comparison;
    $('chartCard').hidden = comparison;
  }

  function markServiceDirty() {
    invalidateAnalysis();
    state.serviceDirty = true;
    $('servicePending').hidden = false;
  }

  function bindWorkspaces() {
    $('settingsToggle').addEventListener('click', () => setSettingsExpanded($('settingsToggle').getAttribute('aria-expanded') !== 'true'));
    const navigate = view => {
      setWorkspace(view);
      $('mainContent').focus({
        preventScroll: true
      });
    };
    for (const id of ['orbitTab', 'editOrbitBtn', 'backToOrbitBtn']) $(id).addEventListener('click', () => navigate('orbit'));
    for (const id of ['analysisTab', 'openAnalysisBtn']) $(id).addEventListener('click', () => navigate('analysis'));
    $('previewBtn').addEventListener('click', refreshPreview);
    $('emptyRunBtn').addEventListener('click', runAnalysis);
    $('saveScenarioMobileBtn').addEventListener('click', saveScenario);
    $('loadScenarioMobileBtn').addEventListener('click', () => $('scenarioFile').click());
    $('countryList').addEventListener('change', markServiceDirty);
    $('regionPresets').addEventListener('click', e => {
      if (e.target.closest('button')) markServiceDirty();
    });
  }

  function setStatus(t, kind = '') {
    const e = $('status');
    e.textContent = t;
    e.className = 'status ' + kind
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    } [c]));
  }

  function num(v, d = 2, s = '') {
    return v === null || v === undefined || !Number.isFinite(+v) ? '–' : (+v).toFixed(d) + s
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(+sec || 0));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return `T+${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  function addCss(href, onFail) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    if (onFail) l.onerror = onFail;
    document.head.appendChild(l)
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s)
    })
  }
  async function loadCesium() {
    addCss(LOCAL_BASE + 'Widgets/widgets.css', () => addCss(CDN_BASE + 'Widgets/widgets.css'));
    try {
      window.CESIUM_BASE_URL = LOCAL_BASE;
      await loadScript(LOCAL_BASE + 'Cesium.js');
      state.cesiumSource = 'local';
      return
    } catch (_) {
      window.CESIUM_BASE_URL = CDN_BASE;
      await loadScript(CDN_BASE + 'Cesium.js');
      state.cesiumSource = 'cdn'
    }
  }

  function selectedCountryCodes() {
    return [...document.querySelectorAll('.service-country:checked')].map(x => x.value)
  }

  function updatePresetStates() {
    if (!state.serviceCatalog) return;
    const selected = new Set(selectedCountryCodes());
    for (const b of document.querySelectorAll('[data-region-code]')) {
      const r = state.serviceCatalog.regions.find(x => x.code === b.dataset.regionCode);
      b.classList.toggle('active', !!r && r.countries.every(c => selected.has(c)))
    }
  }

  function setCountryChecks(codes) {
    const set = new Set(codes);
    for (const el of document.querySelectorAll('.service-country')) el.checked = set.has(el.value);
    updatePresetStates()
  }

  function renderServiceCatalog() {
    const cat = state.serviceCatalog;
    if (!cat) return;
    const preset = $('regionPresets');
    preset.innerHTML = '';
    for (const r of cat.regions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.regionCode = r.code;
      b.textContent = r.name_ko || r.name;
      b.title = r.name;
      b.addEventListener('click', () => {
        const all = r.countries.every(c => selectedCountryCodes().includes(c));
        const next = new Set(selectedCountryCodes());
        for (const c of r.countries) {
          if (all) next.delete(c);
          else next.add(c)
        }
        setCountryChecks([...next])
      });
      preset.appendChild(b)
    }
    const list = $('countryList');
    list.innerHTML = '';
    const groups = new Map();
    for (const c of cat.countries) {
      if (!groups.has(c.region)) groups.set(c.region, []);
      groups.get(c.region).push(c)
    }
    for (const [region, items] of groups) {
      const g = document.createElement('div');
      g.className = 'country-group';
      g.textContent = region;
      list.appendChild(g);
      for (const c of items) {
        const label = document.createElement('label');
        label.className = 'country-item';
        label.innerHTML = `<input class="service-country" type="checkbox" value="${esc(c.code)}"><span>${esc(c.name_ko||c.name)}</span><small>${esc(c.code)}</small>`;
        label.querySelector('input').addEventListener('change', updatePresetStates);
        list.appendChild(label)
      }
    }
    const core = cat.regions.find(x => x.code === 'KLEO_CORE');
    setCountryChecks(core ? core.countries : ['KOR', 'ARE', 'SGP'])
  }
  async function loadServiceCatalog() {
    const r = await fetch('/api/service-regions/catalog');
    if (!r.ok) throw new Error('Failed to load service-region catalog');
    state.serviceCatalog = await r.json();
    renderServiceCatalog()
  }
  async function resolveServiceSelection() {
    const revision = state.revision;
    const req = {
      country_codes: selectedCountryCodes(),
      region_codes: [],
      cities_per_country: +$('citiesPerCountry').value,
      min_elevation_deg: +$('minEl').value
    };
    const r = await fetch('/api/service-regions/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(apiError(d));
    if (revision !== state.revision) return;
    state.serviceSelection = d;
    state.serviceDirty = false;
    renderServiceSummary();
    return d
  }

  function renderServiceSummary() {
    const d = state.serviceSelection;
    if (!d) return;
    $('servicePending').hidden = true;
    const names = d.countries.map(x => x.name_ko || x.name);
    $('serviceSummary').innerHTML = `<b>${names.length}개 국가</b> · 주요 도시 ${d.stations.length}개 · Coverage tile ${d.coverage_areas.length}개<div class="service-chips">${names.map(n=>`<span class="service-chip">${esc(n)}</span>`).join('')}</div>`;
    $('statCountries').textContent = d.countries.length;
    $('statStations').textContent = d.stations.length;
    $('statCoverageAreas').textContent = d.coverage_areas.length
  }

  function featureCode(f) {
    const p = f?.properties || {};
    return String(p.ISO_A3_EH || p.ISO_A3 || p.ADM0_A3 || p.SOV_A3 || '').toUpperCase()
  }
  async function fetchJson(url) {
    const r = await fetch(url, {
      cache: 'force-cache'
    });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json()
  }
  async function ensureBoundaryData() {
    if (state.boundaryData) return state.boundaryData;
    const cat = state.serviceCatalog || {};
    let data = null,
      source = '';
    const tries = [];
    if (cat.boundary_local_available) tries.push(['Natural Earth 50m · local', cat.boundary_local_url]);
    tries.push(['Natural Earth 50m · online', cat.boundary_remote_url]);
    for (const [label, url] of tries) {
      try {
        data = await fetchJson(url);
        source = label;
        break
      } catch (e) {
        console.warn('Boundary source failed', label, e)
      }
    }
    try {
      state.boundaryFallback = await fetchJson(cat.boundary_fallback_url || '/static/service_boundaries_fallback.geojson')
    } catch (e) {
      console.warn('Boundary fallback failed', e)
    }
    if (!data) {
      data = state.boundaryFallback;
      source = 'BBox fallback'
    }
    if (!data) throw new Error('No country-boundary source is available.');
    state.boundaryData = data;
    state.boundarySource = source;
    state.boundaryFeatureMap.clear();
    for (const f of data.features || []) {
      const code = featureCode(f);
      if (code) state.boundaryFeatureMap.set(code, f)
    }
    if (state.boundaryFallback) {
      for (const f of state.boundaryFallback.features || []) {
        const code = featureCode(f);
        if (code && !state.boundaryFeatureMap.has(code)) state.boundaryFeatureMap.set(code, f)
      }
    }
    $('boundarySourceNote').textContent = `Boundary: ${source}`;
    return data
  }
  async function renderServiceBoundaries() {
    if (!state.viewer) return;
    if (state.boundaryDataSource) {
      state.viewer.dataSources.remove(state.boundaryDataSource, true);
      state.boundaryDataSource = null
    }
    if ($('boundaryMode').value === 'off' || !state.serviceSelection) return;
    await ensureBoundaryData();
    const codes = state.serviceSelection.country_codes || [];
    const features = codes.map(c => state.boundaryFeatureMap.get(c)).filter(Boolean);
    if (!features.length) return;
    const fc = {
      type: 'FeatureCollection',
      features
    };
    const ds = await Cesium.GeoJsonDataSource.load(fc, {
      stroke: Cesium.Color.fromCssColorString('#7fd4ff').withAlpha(.95),
      fill: Cesium.Color.fromCssColorString('#2c9bd7').withAlpha(.08),
      strokeWidth: 2,
      clampToGround: true
    });
    state.boundaryDataSource = await state.viewer.dataSources.add(ds);
    $('boundarySourceNote').innerHTML = `Boundary: <b>${esc(state.boundarySource)}</b> · ${features.length}/${codes.length} loaded`
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = +ring[i][0],
        yi = +ring[i][1],
        xj = +ring[j][0],
        yj = +ring[j][1];
      const hit = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside
    }
    return inside
  }

  function pointInGeometry(lon, lat, g) {
    if (!g) return true;
    const poly = coords => pointInRing(lon, lat, coords[0]) && !coords.slice(1).some(r => pointInRing(lon, lat, r));
    if (g.type === 'Polygon') return poly(g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some(poly);
    return true
  }

  function flyServiceArea() {
    const b = state.serviceSelection?.camera_bounds;
    if (!b || !state.viewer) return;
    state.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(b.lon_min, b.lat_min, b.lon_max, b.lat_max),
      duration: .9
    })
  }
  async function applyServiceSelection(fly = true) {
    invalidateAnalysis();
    state.serviceDirty = true;
    const revision = state.revision;
    setStatus('서비스 지역을 적용하고 있습니다…');
    try {
      await resolveServiceSelection();
      if (revision !== state.revision) return;
      await renderServiceBoundaries();
      if (revision !== state.revision) return;
      if (fly) flyServiceArea();
      if (state.snapshot) await fetchSnapshot(+$('timeSlider').value, true);
      if (revision === state.revision) setStatus('서비스 지역을 적용했습니다. 분석을 실행해 결과를 확인하세요.', 'good');
    } catch (e) {
      setStatus('Error: ' + e.message, 'bad');
    }
  }

  function mode() {
    return $('mode').value
  }

  function stations() {
    const src = state.serviceSelection?.stations || [{
      name: 'Seoul',
      lat_deg: 37.5665,
      lon_deg: 126.978
    }, {
      name: 'Dubai',
      lat_deg: 25.2048,
      lon_deg: 55.2708
    }, {
      name: 'Singapore',
      lat_deg: 1.3521,
      lon_deg: 103.8198
    }];
    return src.map(x => ({
      name: x.name,
      lat_deg: +x.lat_deg,
      lon_deg: +x.lon_deg,
      min_elevation_deg: +$('minEl').value
    }))
  }

  function coverageAreas() {
    return (state.serviceSelection?.coverage_areas || []).map(x => ({
      code: x.code,
      name: x.name,
      lon_min: +x.lon_min,
      lat_min: +x.lat_min,
      lon_max: +x.lon_max,
      lat_max: +x.lat_max
    }))
  }

  function walkerPayload() {
    return {
      altitude_km: +$('alt').value,
      inclination_deg: +$('inc').value,
      planes: +$('planes').value,
      sats_per_plane: +$('spp').value,
      phasing: +$('phase').value,
      j2: $('j2').value === 'true',
      duration_min: +$('dur').value,
      step_sec: +$('step').value,
      stations: stations()
    }
  }

  function multiShellPayload() {
    return {
      shells: shellPayloads(),
      duration_min: +$('dur').value,
      step_sec: +$('step').value,
      stations: stations()
    }
  }

  function snapshotPayload(t) {
    const base = {
      mode: mode(),
      time_sec: +t,
      min_elevation_deg: +$('minEl').value,
      heatmap: $('coverageOn').checked,
      heatmap_points: +$('heatRes').value,
      include_orbits: $('orbitOn').checked,
      include_isl: $('islOn').checked,
      include_access: $('accessOn').checked,
      orbit_samples: 96,
      coverage_areas: coverageAreas(),
      stations: stations()
    };
    if (mode() === 'tle') return {
      ...base,
      tle_text: $('tleText').value,
      start_utc: $('startUtc').value.trim() || null
    };
    if (mode() === 'multi_shell') return {
      ...base,
      shells: shellPayloads()
    };
    const w = walkerPayload();
    return {
      ...base,
      altitude_km: w.altitude_km,
      inclination_deg: w.inclination_deg,
      planes: w.planes,
      sats_per_plane: w.sats_per_plane,
      phasing: w.phasing,
      j2: w.j2
    }
  }

  function setModeUI() {
    invalidateAnalysis();
    invalidatePreview();
    const m = mode(),
      tle = m === 'tle',
      multi = m === 'multi_shell';
    $('walkerFields').style.display = m === 'walker' ? 'block' : 'none';
    $('multiShellFields').style.display = multi ? 'block' : 'none';
    $('tleFields').style.display = tle ? 'block' : 'none';
    $('tradeBtn').disabled = state.analysisBusy || m !== 'walker';
    $('groundTrackOn').disabled = tle;
    $('footprintOn').disabled = tle;
    if (tle) clearSelectedGeometry();
    stopPlayback();
    configureTimeSlider()
  }

  function ecefCart(xyz) {
    return Cesium.Cartesian3.fromElements(xyz[0] * 1000, xyz[1] * 1000, xyz[2] * 1000)
  }
  async function initViewer() {
    const v = new Cesium.Viewer('cesiumContainer', {
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false
    });
    state.viewer = v;
    v.scene.globe.depthTestAgainstTerrain = false;
    v.scene.globe.enableLighting = false;
    v.scene.skyAtmosphere.show = true;
    v.scene.fog.enabled = true;
    v.scene.preRender.addEventListener(updatePointOcclusion);
    v.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    const h = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    h.setInputAction(m => {
      const p = v.scene.pick(m.position);
      if (Cesium.defined(p) && p.id && p.id._kleoSatelliteId) {
        state.selectedId = p.id._kleoSatelliteId;
        highlightSelection();
        renderSelected();
        fetchSelectedGeometry()
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    await applyEarthSource();
    applyEarthDisplay();
    flyGlobal(true)
  }
  async function applyEarthSource() {
    if (!state.viewer) return;
    const layers = state.viewer.imageryLayers;
    if (state.baseLayer) {
      layers.remove(state.baseLayer, false);
      state.baseLayer = null
    }
    try {
      let provider;
      if ($('earthSource').value === 'online') {
        provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(ARCGIS, {
          enablePickFeatures: false
        })
      } else {
        provider = await Cesium.SingleTileImageryProvider.fromUrl(OFFLINE_EARTH, {
          rectangle: Cesium.Rectangle.MAX_VALUE,
          credit: 'NASA Blue Marble / K-LEO offline texture'
        })
      }
      state.baseLayer = layers.addImageryProvider(provider, 0);
      setStatus(`Earth imagery: ${$('earthSource').value} · Cesium ${state.cesiumSource}.`, 'good')
    } catch (e) {
      if ($('earthSource').value === 'online') {
        $('earthSource').value = 'offline';
        setStatus('Online Earth unavailable; switched to offline Blue Marble.', 'warn');
        return applyEarthSource()
      }
      setStatus('Earth imagery error: ' + e.message, 'bad')
    }
  }

  function applyEarthDisplay() {
    if (!state.viewer) return;
    const g = state.viewer.scene.globe;
    g.show = $('earthOn').checked;
    const a = +$('earthOpacity').value;
    g.translucency.enabled = a < 0.999;
    g.translucency.frontFaceAlpha = a;
    g.translucency.backFaceAlpha = Math.min(a, .75);
    $('earthOpacityValue').textContent = a.toFixed(2)
  }

  function satVisualSize() {
    return +$('satSize').value
  }

  function selectedSatModel() {
    return SAT_MODELS[$('satModel').value] || SAT_MODELS.default
  }

  function isEarthOccluded(camera, sat) {
    if (!$('earthOn').checked) return false;
    const rx = 6378137.0,
      ry = 6378137.0,
      rz = 6356752.314245;
    const cx = camera.x / rx,
      cy = camera.y / ry,
      cz = camera.z / rz,
      sx = sat.x / rx,
      sy = sat.y / ry,
      sz = sat.z / rz,
      dx = sx - cx,
      dy = sy - cy,
      dz = sz - cz;
    const a = dx * dx + dy * dy + dz * dz,
      b = 2 * (cx * dx + cy * dy + cz * dz),
      c = cx * cx + cy * cy + cz * cz - 1,
      disc = b * b - 4 * a * c;
    if (a <= 0 || disc <= 0) return false;
    const q = Math.sqrt(disc),
      t1 = (-b - q) / (2 * a),
      t2 = (-b + q) / (2 * a),
      eps = 1e-6;
    return (t1 > eps && t1 < 1 - eps) || (t2 > eps && t2 < 1 - eps)
  }

  function updatePointOcclusion() {
    if (!state.viewer) return;
    const pointMode = $('satRender').value === 'point',
      camera = state.viewer.camera.positionWC;
    for (const [id, e] of state.satEntities) {
      if (pointMode) {
        const occluded = e._kleoPosition && isEarthOccluded(camera, e._kleoPosition);
        e.point.show = !occluded;
        e.label.show = !occluded && id === state.selectedId
      } else {
        e.point.show = false;
        e.label.show = id === state.selectedId
      }
    }
  }

  function updateSatelliteStyles() {
    const sz = satVisualSize(),
      model = $('satRender').value === 'model',
      modelUri = selectedSatModel();
    $('satSizeValue').textContent = sz.toFixed(2) + '×';
    $('satModel').disabled = !model;
    for (const [id, e] of state.satEntities) {
      e.model.show = model;
      e.model.uri = modelUri;
      e.point.disableDepthTestDistance = 0;
      e.label.disableDepthTestDistance = 0;
      e.model.minimumPixelSize = 7 * sz;
      e.point.pixelSize = 4.5 * sz;
      e.label.show = model && id === state.selectedId
    }
    updatePointOcclusion()
  }

  function reconcileSatellites(sats) {
    const seen = new Set();
    for (const s of sats) {
      if ([s.ecef_x_km, s.ecef_y_km, s.ecef_z_km].some(v => v === null || !Number.isFinite(+v))) continue;
      seen.add(s.id);
      const pos = Cesium.Cartesian3.fromElements(s.ecef_x_km * 1000, s.ecef_y_km * 1000, s.ecef_z_km * 1000),
        base = s.shell_id ? shellColor(s.shell_id) : Cesium.Color.WHITE,
        pointBase = s.shell_id ? shellColor(s.shell_id) : Cesium.Color.CYAN;
      let e = state.satEntities.get(s.id);
      if (!e) {
        e = state.viewer.entities.add({
          position: pos,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(0, 0, 0)),
          model: {
            uri: selectedSatModel(),
            minimumPixelSize: 14,
            maximumScale: 2500000,
            scale: 1,
            color: base,
            silhouetteColor: Cesium.Color.YELLOW,
            silhouetteSize: 0
          },
          point: {
            pixelSize: 9,
            color: pointBase,
            show: false,
            disableDepthTestDistance: 0
          },
          label: {
            text: s.name,
            font: '12px Segoe UI',
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#07111fcc'),
            pixelOffset: new Cesium.Cartesian2(0, -22),
            show: false,
            disableDepthTestDistance: 0
          }
        });
        e._kleoSatelliteId = s.id;
        e._kleoPosition = pos;
        state.satEntities.set(s.id, e)
      } else {
        e.position = pos;
        e._kleoPosition = pos;
        e.orientation = Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(0, 0, 0));
        e.label.text = s.name
      }
      e._kleoBaseColor = base;
      e._kleoPointColor = pointBase
    }
    for (const [id, e] of [...state.satEntities])
      if (!seen.has(id)) {
        state.viewer.entities.remove(e);
        state.satEntities.delete(id)
      } updateSatelliteStyles();
    highlightSelection()
  }

  function highlightSelection() {
    for (const [id, e] of state.satEntities) {
      const sel = id === state.selectedId;
      e.model.silhouetteSize = sel ? 2.5 : 0;
      e.model.color = sel ? Cesium.Color.fromCssColorString('#ffe26a') : (e._kleoBaseColor || Cesium.Color.WHITE);
      e.point.color = sel ? Cesium.Color.YELLOW : (e._kleoPointColor || Cesium.Color.CYAN)
    }
    updatePointOcclusion()
  }

  function clearPrimitive(name) {
    if (state[name]) {
      state.viewer.scene.primitives.remove(state[name]);
      state[name] = null
    }
  }

  function renderOrbits(viz) {
    clearPrimitive('orbitCollection');
    const paths = viz?.orbits || [];
    $('statOrbit').textContent = paths.length;
    if (!$('orbitOn').checked || !paths.length) return;
    const c = new Cesium.PolylineCollection();
    for (const p of paths) c.add({
      positions: p.ecef_km.map(ecefCart),
      width: 1.25,
      material: Cesium.Material.fromType('Color', {
        color: p.shell_id ? shellColor(p.shell_id, .7) : Cesium.Color.fromCssColorString('#5d83a7').withAlpha(.62)
      })
    });
    state.orbitCollection = state.viewer.scene.primitives.add(c)
  }

  function renderIsl(viz) {
    clearPrimitive('islCollection');
    const links = viz?.isl_links || [];
    $('statIsl').textContent = links.length;
    if (!$('islOn').checked || !links.length) return;
    const c = new Cesium.PolylineCollection();
    for (const l of links) c.add({
      positions: [ecefCart(l.a_ecef_km), ecefCart(l.b_ecef_km)],
      width: 1.1,
      material: Cesium.Material.fromType('Color', {
        color: l.shell_id ? shellColor(l.shell_id, .58) : Cesium.Color.fromCssColorString('#b88cff').withAlpha(.62)
      })
    });
    state.islCollection = state.viewer.scene.primitives.add(c)
  }

  function reconcileGroundStations(viz) {
    const links = viz?.access_links || [],
      seen = new Set();
    for (const l of links) {
      seen.add(l.station);
      if (state.groundEntities.has(l.station)) continue;
      const p = Cesium.Cartesian3.fromDegrees(l.station_lon_deg, l.station_lat_deg, 0);
      const e = state.viewer.entities.add({
        position: p,
        point: {
          pixelSize: 8,
          color: Cesium.Color.LIME,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: l.station,
          font: '11px Segoe UI',
          pixelOffset: new Cesium.Cartesian2(0, -16),
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#07111fcc'),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      state.groundEntities.set(l.station, e)
    }
    for (const [name, e] of [...state.groundEntities])
      if (!seen.has(name)) {
        state.viewer.entities.remove(e);
        state.groundEntities.delete(name)
      }
  }

  function renderAccess(viz) {
    clearPrimitive('accessCollection');
    const links = (viz?.access_links || []).filter(x => x.visible);
    $('statAccess').textContent = links.length;
    reconcileGroundStations(viz);
    if (!$('accessOn').checked || !links.length) return;
    const c = new Cesium.PolylineCollection();
    for (const l of links) c.add({
      positions: [ecefCart(l.station_ecef_km), ecefCart(l.satellite_ecef_km)],
      width: 2,
      material: Cesium.Material.fromType('Color', {
        color: Cesium.Color.fromCssColorString('#60e8a3').withAlpha(.9)
      })
    });
    state.accessCollection = state.viewer.scene.primitives.add(c)
  }

  function heatColor(v, max) {
    if (max <= 0) return [0, 90, 180, 0];
    const t = Math.max(0, Math.min(1, v / max));
    const stops = [
      [0, 60, 170],
      [0, 168, 232],
      [62, 224, 125],
      [255, 226, 102],
      [255, 123, 53],
      [239, 51, 64]
    ];
    const x = t * (stops.length - 1),
      i = Math.min(stops.length - 2, Math.floor(x)),
      f = x - i;
    return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f)).concat([v === 0 ? 35 : 220])
  }
  async function renderCoverage(heatmaps, seq = state.snapshotSeq) {
    const list = Array.isArray(heatmaps) ? heatmaps : (heatmaps ? [heatmaps] : []);
    const visible = $('coverageOn').checked && list.some(h => h?.visible_counts?.length);
    const globalMax = Math.max(0, ...list.map(h => h?.max_visible || 0)),
      prepared = [];
    if (visible)
      for (const hm of list) {
        if (!hm?.visible_counts?.length) continue;
        const rows = hm.visible_counts,
          h = rows.length,
          w = rows[0].length,
          canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d'),
          img = ctx.createImageData(w, h),
          feature = state.boundaryFeatureMap.get(String(hm.area_code || '').toUpperCase());
        for (let y = 0; y < h; y++) {
          const src = h - 1 - y,
            lat = hm.lat_deg[src];
          for (let x = 0; x < w; x++) {
            const lon = hm.lon_deg[x],
              inside = !feature || pointInGeometry(lon, lat, feature.geometry),
              c = heatColor(rows[src][x], globalMax),
              o = (y * w + x) * 4;
            img.data[o] = c[0];
            img.data[o + 1] = c[1];
            img.data[o + 2] = c[2];
            img.data[o + 3] = inside ? c[3] : 0;
          }
        }
        ctx.putImageData(img, 0, 0);
        const rectangle = Cesium.Rectangle.fromDegrees(hm.lon_deg[0], hm.lat_deg[0], hm.lon_deg[w - 1], hm.lat_deg[h - 1]);
        const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
          rectangle,
          credit: 'K-LEO geometric visibility'
        });
        if (seq !== state.snapshotSeq) return;
        prepared.push(provider);
      }
    if (seq !== state.snapshotSeq) return;
    for (const layer of state.coverageLayers) state.viewer.imageryLayers.remove(layer, true);
    state.coverageLayers = [];
    for (const provider of prepared) {
      const layer = state.viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = +$('coverageOpacity').value;
      state.coverageLayers.push(layer);
    }
    $('heatmap').style.display = visible ? 'block' : 'none';
    $('statHeat').textContent = globalMax;
    $('coverageLegend').textContent = `Visible satellites · 0 → ${globalMax} · ${list.length} service area(s)`;
  }

  function prop(k, v) {
    return `<div class="prop"><span>${esc(k)}</span><b>${esc(v)}</b></div>`
  }

  function renderSelected() {
    const s = state.snapshot?.satellites?.find(x => x.id === state.selectedId);
    if (!s) {
      $('satDetails').className = 'empty-details';
      $('satDetails').innerHTML = '<div class="empty-icon" aria-hidden="true">⌖</div>지도의 위성을 클릭하세요.<br>위치, 속도, 궤도 속성을 확인할 수 있습니다.';
      return
    }
    $('satDetails').className = '';
    let h = `<div class="sat-title">${esc(s.name)}</div><div class="sat-source">${esc(s.source)} · ${esc(s.id)}</div><div class="props">`;
    h += prop('위도', num(s.lat_deg, 4, '°')) + prop('경도', num(s.lon_deg, 4, '°')) + prop('고도', num(s.altitude_km, 2, ' km')) + prop('속도', num(s.speed_km_s, 3, ' km/s')) + prop('경사각', num(s.inclination_deg, 4, '°')) + prop('RAAN', num(s.raan_deg, 4, '°')) + prop('공전 주기', num(s.period_min, 3, ' min'));
    if (s.source === 'Walker' || s.source === 'Multi-shell Walker') {
      if (s.shell_id) h += prop('Shell', `${s.shell_id} · ${s.shell_name||''}`);
      h += prop('궤도면 / 슬롯', `${s.plane} / ${s.slot}`) + prop('위도 인수', num(s.argument_latitude_deg, 4, '°'))
    } else h += prop('NORAD ID', s.norad_id) + prop('TLE epoch', s.epoch_utc || '–') + prop('Eccentricity', num(s.eccentricity, 7)) + prop('Arg. perigee', num(s.arg_perigee_deg, 4, '°')) + prop('Mean motion', num(s.mean_motion_rev_day, 6, ' rev/day'));
    h += prop('ECEF X/Y/Z', `${num(s.ecef_x_km,1)} / ${num(s.ecef_y_km,1)} / ${num(s.ecef_z_km,1)} km`) + '</div>';
    $('satDetails').innerHTML = h
  }

  function clearSelectedGeometry() {
    state.geometrySeq++;
    if (state.groundTrackCollection) {
      state.viewer?.scene.primitives.remove(state.groundTrackCollection);
      state.groundTrackCollection = null
    }
    if (state.footprintEntity) {
      state.viewer?.entities.remove(state.footprintEntity);
      state.footprintEntity = null
    }
    $('statTrack').textContent = '0';
    $('statFootprint').textContent = '0 km'
  }

  function renderSelectedGeometry(g) {
    clearSelectedGeometry();
    if (!g) return;
    if ($('groundTrackOn').checked && g.ground_track?.segments_lon_lat_deg?.length) {
      const c = new Cesium.PolylineCollection();
      for (const seg of g.ground_track.segments_lon_lat_deg) {
        c.add({
          positions: seg.map(x => Cesium.Cartesian3.fromDegrees(x[0], x[1], 12000)),
          width: 2.2,
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.fromCssColorString('#ff9f43').withAlpha(.95)
          })
        })
      }
      state.groundTrackCollection = state.viewer.scene.primitives.add(c);
      $('statTrack').textContent = g.ground_track.segments_lon_lat_deg.length + ' seg'
    }
    if ($('footprintOn').checked && g.footprint?.lon_lat_deg?.length) {
      const pos = g.footprint.lon_lat_deg.map(x => Cesium.Cartesian3.fromDegrees(x[0], x[1], 2000));
      state.footprintEntity = state.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(pos),
          material: Cesium.Color.fromCssColorString('#42d3ff').withAlpha(.13),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#42d3ff').withAlpha(.85),
          perPositionHeight: true
        }
      });
      $('statFootprint').textContent = num(g.footprint.surface_radius_km, 0, ' km')
    }
  }

  function geometryPayload() {
    if (!state.selectedId || mode() === 'tle') return null;
    const base = {
      mode: mode(),
      satellite_id: state.selectedId,
      time_sec: +$('timeSlider').value,
      min_elevation_deg: +$('minEl').value,
      ground_track_span_min: +$('trackSpan').value,
      ground_track_samples: 181,
      footprint_samples: 72
    };
    if (mode() === 'multi_shell') return {
      ...base,
      shells: shellPayloads()
    };
    const w = walkerPayload();
    return {
      ...base,
      altitude_km: w.altitude_km,
      inclination_deg: w.inclination_deg,
      planes: w.planes,
      sats_per_plane: w.sats_per_plane,
      phasing: w.phasing,
      j2: w.j2
    }
  }
  async function fetchSelectedGeometry(quiet = false) {
    const req = geometryPayload();
    if (!req || (!$('groundTrackOn').checked && !$('footprintOn').checked)) {
      clearSelectedGeometry();
      return;
    }
    const seq = ++state.geometrySeq,
      revision = state.revision,
      snapshotSeq = state.snapshotSeq;
    try {
      const r = await fetch('/api/orbital-geometry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(req)
        }),
        d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      if (seq !== state.geometrySeq || revision !== state.revision || snapshotSeq !== state.snapshotSeq) return;
      renderSelectedGeometry(d);
    } catch (e) {
      if (!quiet) setStatus('Geometry: ' + e.message, 'warn');
    }
  }
  async function renderSnapshot(snap, seq = state.snapshotSeq) {
    await renderCoverage(snap.heatmaps || snap.heatmap, seq);
    if (seq !== state.snapshotSeq) return;
    state.snapshot = snap;
    renderOrbitSummary(snap);
    if (state.selectedId && !snap.satellites.some(s => s.id === state.selectedId)) {
      state.selectedId = null;
      clearSelectedGeometry();
    }
    reconcileSatellites(snap.satellites);
    const viz = snap.visualization || {};
    renderOrbits(viz);
    renderIsl(viz);
    renderAccess(viz);
    renderSelected();
    $('timeLabel').textContent = fmtTime(snap.time_sec);
    $('timeSlider').value = String(Math.min(+$('timeSlider').max, snap.time_sec));
    if (state.selectedId) await fetchSelectedGeometry(true);
    if (seq === state.snapshotSeq && snap.errors?.length) setStatus(`Snapshot completed with ${snap.errors.length} SGP4 warning(s).`, 'warn');
  }
  async function fetchSnapshot(t, quiet = false) {
    const seq = ++state.snapshotSeq;
    state.snapshotController?.abort();
    const controller = new AbortController();
    state.snapshotController = controller;
    if (!quiet) setStatus('궤도 배치를 적용하고 있습니다…');
    try {
      const r = await fetch('/api/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(snapshotPayload(t)),
        signal: controller.signal
      });
      const d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      if (seq !== state.snapshotSeq) return false;
      await renderSnapshot(d, seq);
      if (seq !== state.snapshotSeq) return false;
      if (!quiet) setStatus('궤도 배치를 적용했습니다. 위성을 선택하거나 시간을 이동해 확인하세요.', 'good');
      return true;
    } catch (e) {
      if (seq !== state.snapshotSeq || e.name === 'AbortError') return false;
      stopPlayback();
      setStatus('Error: ' + e.message, 'bad');
      return false;
    }
  }

  function renderTimeline(d) {
    const traces = (d.station_timelines || []).map(t => ({
      x: t.times_sec.map(x => x / 60),
      y: t.visible_counts,
      type: 'scatter',
      mode: 'lines',
      name: t.name
    }));
    Plotly.react('coverage', traces, {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: {
        color: '#cbd9e8',
        size: 12
      },
      colorway: SHELL_COLORS,
      margin: {
        l: 50,
        r: 14,
        t: 50,
        b: 42
      },
      xaxis: {
        title: {
          text: '시간 (min)'
        },
        gridcolor: '#21384e'
      },
      yaxis: {
        title: {
          text: '가시 위성 수'
        },
        rangemode: 'tozero',
        gridcolor: '#21384e'
      },
      legend: {
        y: 1.08,
        yanchor: 'bottom',
        x: 0,
        xanchor: 'left',
        orientation: 'h'
      }
    }, {
      responsive: true,
      displaylogo: false
    })
  }

  function renderAnalysis(d) {
    showAnalysisResults();
    $('kSat').textContent = d.total_satellites ?? '–';
    $('kPeriod').textContent = (d.mode === 'tle' || d.mode === 'multi_shell') ? (d.mode === 'multi_shell' ? '주기 다양' : (d.snapshot?.length ? num(d.snapshot[0].period_min, 2, ' min') : 'mixed')) : num(d.orbital_period_min, 2, ' min');
    $('kAvail').textContent = d.coverage_summary ? num(100 * d.coverage_summary.worst_availability, 1, '%') : '–';
    $('kVis').textContent = d.coverage_summary ? num(d.coverage_summary.mean_visible, 2) : '–';
    renderTimeline(d);
    const rows = (d.station_timelines || []).map(x => `<tr><td>${esc(x.name)}</td><td>${num(100*x.availability,1,'%')}</td><td>${num(x.avg_visible,2)}</td><td>${num(x.handovers_per_hour,1,'/h')}</td><td>${num(x.max_sampled_outage_sec,0,' s')}</td></tr>`).join('');
    $('resultTable').innerHTML = `<table><thead><tr><th>관측 도시</th><th>가시 시간 비율</th><th>평균 가시 위성 수</th><th>위성 전환 / h</th><th>최대 단절시간</th></tr></thead><tbody>${rows}</tbody></table>`;
    $('tableTitle').textContent = '도시별 가시성 결과'
  }
  async function runAnalysis() {
    if (state.analysisBusy) return;
    stopPlayback();
    invalidateAnalysis();
    const revision = state.revision;
    setAnalysisBusy(true);
    setStatus('가시성을 분석하고 있습니다…');
    try {
      if (state.serviceDirty) {
        await resolveServiceSelection();
        if (revision !== state.revision) return;
      }
      let url = '/api/simulate',
        body = walkerPayload();
      if (mode() === 'multi_shell') {
        url = '/api/multi-shell/simulate';
        body = multiShellPayload();
      } else if (mode() === 'tle') {
        url = '/api/tle/simulate';
        body = {
          tle_text: $('tleText').value,
          start_utc: $('startUtc').value.trim() || null,
          duration_min: +$('dur').value,
          step_sec: +$('step').value,
          stations: stations()
        };
      }
      const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }),
        d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      if (revision !== state.revision) return;
      renderAnalysis(d);
      recordAnalysis(d);
      setStatus('가시성 분석을 완료했습니다. 그래프와 도시별 결과를 확인하세요.', 'good');
    } catch (e) {
      if (revision === state.revision) setStatus('Error: ' + e.message, 'bad');
    } finally {
      setAnalysisBusy(false);
    }
  }
  async function parseTLE() {
    setStatus('Parsing TLE…');
    try {
      const r = await fetch('/api/tle/parse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tle_text: $('tleText').value
          })
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'TLE parse error');
      const f = d.satellites[0];
      $('tleMeta').innerHTML = `Parsed <b>${d.count}</b> satellite(s) · SGP4: <b>${d.sgp4_available?'available':'not installed'}</b>${f?`<br>${esc(f.name)} · NORAD ${esc(f.norad_id)} · ${esc(f.epoch_utc)}`:''}`;
      setStatus('TLE parsed successfully.', d.sgp4_available ? 'good' : 'warn')
    } catch (e) {
      $('tleMeta').textContent = e.message;
      setStatus('Error: ' + e.message, 'bad')
    }
  }
  async function runTrade() {
    if (mode() !== 'walker' || state.analysisBusy) return;
    stopPlayback();
    invalidateAnalysis();
    const revision = state.revision;
    setAnalysisBusy(true);
    const p = walkerPayload(),
      req = {
        altitudes_km: [500, 888, 1280],
        inclinations_deg: [p.inclination_deg],
        planes_list: [8, 16],
        sats_per_plane_list: [16],
        phasing: p.phasing,
        j2: p.j2,
        duration_min: p.duration_min,
        step_sec: Math.max(120, p.step_sec),
        min_availability: .95,
        stations: p.stations
      };
    setStatus('6개 위성군 후보를 비교하고 있습니다…');
    try {
      if (state.serviceDirty) {
        await resolveServiceSelection();
        if (revision !== state.revision) return;
        req.stations = stations();
      }
      const r = await fetch('/api/trade-study', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(req)
        }),
        d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      if (revision !== state.revision) return;
      showAnalysisResults(true);
      const rows = d.results.map((x, i) => `<tr><td>${i+1}</td><td>${x.altitude_km}</td><td>${x.inclination_deg}°</td><td>${x.planes}×${x.sats_per_plane}</td><td>${num(100*x.worst_availability,2,'%')}</td><td>${num(x.worst_sampled_outage_sec,0,' s')}</td><td>${x.meets_availability?'충족':'미달'}</td></tr>`).join('');
      $('resultTable').innerHTML = `<table><thead><tr><th>순위</th><th>고도 km</th><th>경사각</th><th>궤도면 × 위성</th><th>최저 가시 비율</th><th>최대 단절시간</th><th>95% 충족</th></tr></thead><tbody>${rows}</tbody></table>`;
      $('tableTitle').textContent = `후보 비교 · ${req.duration_min}분 / ${req.step_sec}초 간격 · 목표 충족 최소 위성군 우선`;
      recordAnalysis(d);
      setStatus('후보 비교를 완료했습니다. JSON으로 도시별 상세 결과를 저장할 수 있습니다.', 'good');
    } catch (e) {
      if (revision === state.revision) setStatus('Error: ' + e.message, 'bad');
    } finally {
      setAnalysisBusy(false);
    }
  }

  function configureTimeSlider() {
    const max = Math.max(60, (+$('dur').value || 120) * 60),
      step = Math.max(1, +$('step').value || 60);
    $('timeSlider').max = String(max);
    $('timeSlider').step = String(step);
    $('timeSlider').value = '0';
    $('timeLabel').textContent = fmtTime(0);
  }

  function stopPlayback() {
    state.playing = false;
    state.playbackGeneration++;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    $('playBtn').textContent = '▶ 재생';
  }

  function startPlayback() {
    if (state.playing) {
      stopPlayback();
      return;
    }
    state.playing = true;
    const generation = ++state.playbackGeneration;
    $('playBtn').textContent = 'Ⅱ 일시정지';
    const tick = async () => {
      if (!state.playing || generation !== state.playbackGeneration) return;
      const sl = $('timeSlider'),
        max = +sl.max,
        step = Math.max(1, +$('step').value || 60),
        speed = +$('speed').value || 1;
      let next = +sl.value + step * speed;
      if (next > max) next = 0;
      const ok = await fetchSnapshot(next, true);
      if (!ok || !state.playing || generation !== state.playbackGeneration) return;
      state.timer = setTimeout(tick, 650);
    };
    state.timer = setTimeout(tick, 0);
  }

  function sliderChanged() {
    stopPlayback();
    const v = +$('timeSlider').value;
    $('timeLabel').textContent = fmtTime(v);
    clearTimeout(state.sliderDebounce);
    state.sliderDebounce = setTimeout(() => fetchSnapshot(v, true), 110);
  }
  const GLOBAL_VIEW = {
    lon: 100,
    lat: 20,
    height: 24000000
  };

  function flyGlobal(instant = false) {
    if (!state.viewer) return;
    const destination = Cesium.Cartesian3.fromDegrees(GLOBAL_VIEW.lon, GLOBAL_VIEW.lat, GLOBAL_VIEW.height);
    if (instant) {
      state.viewer.camera.setView({
        destination
      });
      return
    }
    state.viewer.camera.flyTo({
      destination,
      duration: .8
    })
  }

  function flySelected() {
    const e = state.satEntities.get(state.selectedId);
    if (!e) {
      setStatus('Select a satellite first.', 'warn');
      return
    }
    state.viewer.flyTo(e, {
      duration: .8,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), 1800000)
    })
  }

  function refetchLayers() {
    if (state.snapshot) fetchSnapshot(+$('timeSlider').value, true)
  }

  function bind() {
    $('mode').addEventListener('change', setModeUI);
    $('addShellBtn').addEventListener('click', () => addShell({}));
    $('runBtn').addEventListener('click', runAnalysis);
    $('tradeBtn').addEventListener('click', runTrade);
    $('tleParseBtn').addEventListener('click', parseTLE);
    $('tleExampleBtn').addEventListener('click', () => {
      $('tleText').value = verificationTLE;
      parseTLE()
    });
    $('applyServiceBtn').addEventListener('click', () => applyServiceSelection(false));
    $('clearServiceBtn').addEventListener('click', () => {
      setCountryChecks([]);
      const k = document.querySelector('.service-country[value="KOR"]');
      if (k) k.checked = true;
      updatePresetStates();
      applyServiceSelection(false)
    });
    $('citiesPerCountry').addEventListener('change', () => applyServiceSelection(false));
    $('boundaryMode').addEventListener('change', renderServiceBoundaries);
    $('playBtn').addEventListener('click', startPlayback);
    $('resetTimeBtn').addEventListener('click', () => {
      stopPlayback();
      $('timeSlider').value = '0';
      fetchSnapshot(0, true)
    });
    $('timeSlider').addEventListener('input', sliderChanged);
    $('dur').addEventListener('change', configureTimeSlider);
    $('step').addEventListener('change', configureTimeSlider);
    $('minEl').addEventListener('change', () => applyServiceSelection(false));
    $('earthOn').addEventListener('change', applyEarthDisplay);
    $('earthSource').addEventListener('change', applyEarthSource);
    $('earthOpacity').addEventListener('input', applyEarthDisplay);
    $('satSize').addEventListener('input', updateSatelliteStyles);
    $('satRender').addEventListener('change', updateSatelliteStyles);
    $('satModel').addEventListener('change', updateSatelliteStyles);
    for (const id of ['orbitOn', 'islOn', 'accessOn', 'coverageOn']) $(id).addEventListener('change', refetchLayers);
    for (const id of ['groundTrackOn', 'footprintOn']) $(id).addEventListener('change', () => fetchSelectedGeometry(true));
    $('trackSpan').addEventListener('input', () => {
      $('trackSpanValue').textContent = $('trackSpan').value + ' min'
    });
    $('trackSpan').addEventListener('change', () => fetchSelectedGeometry(true));
    $('coverageOpacity').addEventListener('input', () => {
      const a = +$('coverageOpacity').value;
      $('coverageOpacityValue').textContent = a.toFixed(2);
      for (const layer of state.coverageLayers) layer.alpha = a
    });
    $('heatRes').addEventListener('input', () => {
      $('heatResValue').textContent = `${$('heatRes').value}×${$('heatRes').value}`
    });
    $('heatRes').addEventListener('change', refetchLayers);
    $('globalView').addEventListener('click', () => flyGlobal(false));
    $('serviceView').addEventListener('click', flyServiceArea);
    $('selectedView').addEventListener('click', flySelected)
  }

  function apiError(payload) {
    const detail = payload?.detail;
    if (Array.isArray(detail)) return detail.map(x => `${(x.loc||[]).slice(1).join('.')}: ${x.msg}`).join('; ');
    return typeof detail === 'string' ? detail : 'Request failed';
  }

  function setAnalysisBusy(busy) {
    state.analysisBusy = busy;
    $('runBtn').disabled = busy;
    $('emptyRunBtn').disabled = busy;
    $('runBtn').textContent = busy ? '분석 중…' : '가시성 분석 실행';
    $('emptyRunBtn').textContent = busy ? '분석 중…' : '가시성 분석 실행';
    $('tradeBtn').disabled = busy || mode() !== 'walker';
    $('analysisResults').setAttribute('aria-busy', String(busy));
  }

  function invalidateAnalysis() {
    stopPlayback();
    clearTimeout(state.sliderDebounce);
    state.revision++;
    state.snapshotSeq++;
    state.snapshotController?.abort();
    state.analysis = null;
    clearSelectedGeometry();
    for (const id of ['kSat', 'kPeriod', 'kAvail', 'kVis']) $(id).textContent = '–';
    $('resultTable').textContent = '';
    $('analysisResults').hidden = true;
    $('analysisEmpty').hidden = false;
    if (typeof Plotly !== 'undefined') Plotly.purge('coverage');
    $('exportJsonBtn').disabled = true;
    $('exportCsvBtn').disabled = true;
    $('analysisNotice').textContent = '분석 대기 · 현재 설정으로 분석을 실행하세요.';
  }

  function recordAnalysis(data) {
    state.analysis = data;
    $('exportJsonBtn').disabled = false;
    $('exportCsvBtn').disabled = false;
    const m = data.analysis_metadata;
    $('analysisNotice').textContent = `${m.inputs.duration_min}분 분석 · ${m.inputs.step_sec}초 간격 · ${data.results?'후보 비교':'기하학적 가시성'}`;
  }

  function downloadText(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], {
        type
      })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveScenario() {
    try {
      const scenario = {
        schema_version: 'kleo.scenario.v1',
        name: 'K-LEO scenario',
        configuration: snapshotPayload(0),
        selection: {
          country_codes: selectedCountryCodes(),
          region_codes: [],
          cities_per_country: +$('citiesPerCountry').value,
          min_elevation_deg: +$('minEl').value
        },
        duration_min: +$('dur').value,
        step_sec: +$('step').value
      };
      const r = await fetch('/api/scenario/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(scenario)
        }),
        d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      downloadText('kleo-scenario-v1.2.json', JSON.stringify(d, null, 2), 'application/json');
      setStatus('설정을 JSON으로 저장했습니다.', 'good');
    } catch (e) {
      setStatus('Save failed: ' + e.message, 'bad');
    }
  }
  async function loadScenario(file) {
    try {
      if (!file) return;
      if (file.size > 1000000) throw new Error('Scenario JSON must be smaller than 1 MB.');
      const input = JSON.parse(await file.text());
      const r = await fetch('/api/scenario/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(input)
        }),
        d = await r.json();
      if (!r.ok) throw new Error(apiError(d));
      const c = d.configuration;
      invalidateAnalysis();
      $('mode').value = c.mode;
      for (const [id, key] of [
          ['alt', 'altitude_km'],
          ['inc', 'inclination_deg'],
          ['planes', 'planes'],
          ['spp', 'sats_per_plane'],
          ['phase', 'phasing']
        ]) $(id).value = c[key];
      $('j2').value = String(c.j2);
      $('dur').value = d.duration_min;
      $('step').value = d.step_sec;
      $('minEl').value = d.selection.min_elevation_deg;
      $('tleText').value = c.tle_text || '';
      $('startUtc').value = c.start_utc || '';
      $('shellList').innerHTML = '';
      for (const sh of c.shells || []) addShell(sh);
      if (c.mode !== 'multi_shell' && !c.shells?.length) initShells();
      $('heatRes').value = c.heatmap_points;
      for (const [id, key] of [
          ['coverageOn', 'heatmap'],
          ['orbitOn', 'include_orbits'],
          ['islOn', 'include_isl'],
          ['accessOn', 'include_access']
        ]) $(id).checked = c[key];
      $('citiesPerCountry').value = d.selection.cities_per_country;
      setCountryChecks(d.selection.country_codes);
      setModeUI();
      await applyServiceSelection(false);
      configureTimeSlider();
      $('heatResValue').textContent = `${$('heatRes').value}×${$('heatRes').value}`;
      await refreshPreview();
      setStatus('설정을 불러왔습니다. 상세 분석에서 새 결과를 계산하세요.', 'good');
    } catch (e) {
      setStatus('Load failed: ' + e.message, 'bad');
    } finally {
      $('scenarioFile').value = '';
    }
  }

  function exportResultsJSON() {
    if (state.analysis) downloadText('kleo-results-v1.2.json', JSON.stringify(state.analysis, null, 2), 'application/json');
  }

  function csvCell(v) {
    let t = String(v ?? '');
    if (/^[=+@\-\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  function exportResultsCSV() {
    if (!state.analysis) return;
    const d = state.analysis,
      m = d.analysis_metadata;
    const meta = [m.app_version, m.input_sha256, m.inputs.duration_min, m.inputs.step_sec, 'geometric_visibility', 'left_hold_intervals', JSON.stringify(m.inputs)];
    let header = ['app_version', 'input_sha256', 'duration_min', 'step_sec', 'availability_basis', 'sampling_method', 'inputs_json'],
      rows;
    if (d.results) {
      header.push('altitude_km', 'inclination_deg', 'planes', 'sats_per_plane', 'total_satellites', 'worst_availability', 'worst_sampled_outage_sec', 'meets_availability');
      rows = d.results.map(x => [...meta, x.altitude_km, x.inclination_deg, x.planes, x.sats_per_plane, x.total_satellites, x.worst_availability, x.worst_sampled_outage_sec, x.meets_availability]);
    } else {
      header.push('station', 'lat_deg', 'lon_deg', 'min_elevation_deg', 'availability', 'avg_visible', 'handovers_per_hour', 'reconnection_count', 'max_sampled_outage_sec');
      rows = (d.station_timelines || []).map(x => [...meta, x.name, x.lat_deg, x.lon_deg, x.min_elevation_deg, x.availability, x.avg_visible, x.handovers_per_hour, x.reconnection_count, x.max_sampled_outage_sec]);
    }
    downloadText('kleo-results-v1.2.csv', '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function bindRelease() {
    $('saveScenarioBtn').addEventListener('click', saveScenario);
    $('loadScenarioBtn').addEventListener('click', () => $('scenarioFile').click());
    $('scenarioFile').addEventListener('change', e => loadScenario(e.target.files[0]));
    $('exportJsonBtn').addEventListener('click', exportResultsJSON);
    $('exportCsvBtn').addEventListener('click', exportResultsCSV);
    document.addEventListener('input', e => {
      const orbit = ['alt', 'inc', 'planes', 'spp', 'phase', 'j2', 'tleText', 'startUtc'].includes(e.target.id) || e.target.closest('.shell-card');
      if (orbit || ['dur', 'step'].includes(e.target.id)) invalidateAnalysis();
      if (orbit) invalidatePreview();
    });
    $('shellList').addEventListener('click', e => {
      if (e.target.classList.contains('sh-remove')) {
        invalidateAnalysis();
        invalidatePreview();
      }
    });
    $('addShellBtn').addEventListener('click', () => {
      invalidateAnalysis();
      invalidatePreview();
    });
  }

  async function bootstrap() {
    initShells();
    bind();
    bindRelease();
    bindWorkspaces();
    configureTimeSlider();
    setModeUI();
    setWorkspace('orbit');
    $('tleText').value = verificationTLE;
    try {
      await loadServiceCatalog();
      await resolveServiceSelection();
    } catch (e) {
      setStatus('서비스 지역을 불러오지 못했습니다: ' + e.message, 'warn');
    }
    try {
      await loadCesium();
      await initViewer();
      $('previewBtn').disabled = false;
      await refreshPreview();
      flyGlobal(true);
    } catch (e) {
      console.error(e);
      $('viewerError').style.display = 'flex';
      $('viewerError').innerHTML = `<div><b>3D 지도를 불러오지 못했습니다.</b><br><br>${esc(e.message)}<br><br>네트워크 연결 또는 로컬 지도 자산을 확인한 뒤 새로고침하세요.</div>`;
      setStatus('3D 지도를 불러오지 못했습니다. 상세 분석은 계속 사용할 수 있습니다.', 'bad');
    }
  }
  bootstrap();
})();
