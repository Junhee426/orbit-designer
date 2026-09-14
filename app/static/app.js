(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  const CVER = '1.144';
  const CDN_BASE = `https://cesium.com/downloads/cesiumjs/releases/${CVER}/Build/Cesium/`;
  const LOCAL_BASE = '/static/vendor/cesium/';
  const OFFLINE_EARTH = '/static/earth_blue_marble_2048.jpg';
  const OUTLINE_EARTH = '/static/earth_outline.png';
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

  function shellPayloads(validate = false) {
    const cards = [...document.querySelectorAll('.shell-card')];
    if (validate) {
      if (!cards.length) throw new Error('궤도층을 하나 이상 추가하세요.');
      for (const [index, card] of cards.entries()) {
        const invalid = [...card.querySelectorAll('input')].find(input => !input.checkValidity());
        if (invalid) {
          setWorkspace('orbit');
          setSettingsExpanded(true);
          invalid.focus();
          invalid.reportValidity();
          throw new Error(`${index + 1}번 궤도층의 ${invalid.getAttribute('aria-label')} 입력값을 확인하세요.`);
        }
      }
    }
    return cards.map(shellCardData)
  }

  function updateShellSummary() {
    const shells = shellPayloads(),
      total = shells.reduce((a, x) => a + x.planes * x.sats_per_plane, 0);
    $('shellSummary').textContent = `${shells.length}개 궤도층 · 총 ${Number.isFinite(total) ? total.toLocaleString('ko-KR') : '–'}기`;
    for (const c of document.querySelectorAll('.shell-card')) {
      const d = shellCardData(c),
        e = c.querySelector('.shell-total');
      if (e) e.textContent = `${d.planes}개 궤도면 × ${d.sats_per_plane}기 = ${Number.isFinite(d.planes*d.sats_per_plane) ? d.planes*d.sats_per_plane : '–'}기`;
      c.querySelector('.sh-remove').disabled = shells.length <= 1;
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
    const numberField = (cls, label, value, min, max, step = 1) => `<div class="field"><label>${label}<input class="${cls}" aria-label="${label}" type="number" required min="${min}" max="${max}" step="${step}" value="${esc(value)}"></label></div>`;
    card.innerHTML = `
      <div class="shell-card-head"><span class="shell-id">${esc(id)}</span><div class="shell-actions"><button class="sh-copy" type="button">복제</button><button class="sh-remove" type="button">삭제</button></div></div>
      <div class="field"><label>궤도층 이름<input class="sh-name" value="${esc(shell.name||`궤도층 ${idx}`)}" aria-label="궤도층 이름"></label></div>
      <div class="row">${numberField('sh-alt', '고도 · km', shell.altitude_km??1280, 160, 3000, 'any')}${numberField('sh-inc', '경사각 · °', shell.inclination_deg??42, 0, 180, 'any')}</div>
      <div class="row">${numberField('sh-planes', '궤도면 수', shell.planes??8, 1, 128)}${numberField('sh-spp', '면당 위성 수', shell.sats_per_plane??16, 1, 256)}</div>
      <div class="row">${numberField('sh-phase', 'Walker 위상 · F', shell.phasing??1, 0, 127)}<div class="field"><label>J2 승교점 이동<select class="sh-j2" aria-label="J2 승교점 이동"><option value="true" ${(shell.j2??true)?'selected':''}>사용</option><option value="false" ${shell.j2===false?'selected':''}>사용 안 함</option></select></label></div></div>
      <div class="shell-total"></div>`;
    card.querySelector('.sh-copy').addEventListener('click', () => {
      const copy = shellCardData(card);
      const added = addShell({...copy, id: undefined, name: `${copy.name} 복사`});
      invalidateAnalysis();
      invalidatePreview();
      added.querySelector('.sh-name').focus();
    });
    card.querySelector('.sh-remove').addEventListener('click', () => {
      if (document.querySelectorAll('.shell-card').length <= 1) return;
      card.remove();
      updateShellSummary();
      invalidateAnalysis();
      invalidatePreview();
      $('addShellBtn').focus();
    });
    for (const e of card.querySelectorAll('input,select')) e.addEventListener('input', updateShellSummary);
    $('shellList').appendChild(card);
    updateShellSummary();
    return card;
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
    earthSourceSeq: 0,
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
    playbackGeneration: 0,
    viewMode: '3d',
    flatCamera: { lon: 120, lat: 20 },
    flatDrag: null,
    flatHitPoints: [],
    worldOutlines: [],
    selectedGeometry: null,
    cesiumFailed: false
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
        renderFlat();
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
      $('analysisConfig').textContent = `다층 궤도 · ${shells.length}개 층 · 총 ${shells.reduce((n,s)=>n+s.planes*s.sats_per_plane,0)}기`;
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
    setCountryChecks(['KOR'])
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
      shells: shellPayloads(true),
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
      shells: shellPayloads(true)
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

// Shared Earth globe renderer (identical across K-LEO services): textured orthographic
// sphere using the same Blue Marble texture, projection math, and atmosphere glow.
let earthTexture=null;const globeCache={};
function observerFrame(latDeg,lonDeg){
  const lat=latDeg*Math.PI/180,lon=lonDeg*Math.PI/180;
  return{up:[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],
    east:[-Math.sin(lon),Math.cos(lon),0],
    north:[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)]};
}
function loadEarthTexture(){
  const img=new Image();
  img.onload=()=>{
    const off=document.createElement('canvas');off.width=img.width;off.height=img.height;
    const c=off.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0);
    earthTexture={width:img.width,height:img.height,data:c.getImageData(0,0,img.width,img.height).data};
    globeCache.key=null;renderFlat();
  };
  img.src=OFFLINE_EARTH;
}
function paintGlobeTexture(ctx,cx,cy,radius,dpr,latDeg,lonDeg){
  const size=Math.max(32,Math.min(650,Math.round(radius*2*dpr)));
  const key=[size,latDeg,lonDeg,!!earthTexture].join(':');
  if(globeCache.key!==key){
    const off=document.createElement('canvas');off.width=off.height=size;
    const octx=off.getContext('2d');
    const pixels=octx.createImageData(size,size),d=pixels.data,r=size/2,frame=observerFrame(latDeg,lonDeg),tex=earthTexture;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const ex=(x+.5-r)/r,ny=-(y+.5-r)/r,dist=ex*ex+ny*ny;
      if(dist>1)continue;
      const uz=Math.sqrt(1-dist),index=(y*size+x)*4;
      const worldX=frame.east[0]*ex+frame.north[0]*ny+frame.up[0]*uz;
      const worldY=frame.east[1]*ex+frame.north[1]*ny+frame.up[1]*uz;
      const worldZ=frame.east[2]*ex+frame.north[2]*ny+frame.up[2]*uz;
      const lon=Math.atan2(worldY,worldX),lat=Math.asin(Math.max(-1,Math.min(1,worldZ)));
      const light=.42+.58*uz;
      if(tex){
        const tx=Math.min(tex.width-1,Math.floor((lon/(2*Math.PI)+.5)*tex.width));
        const ty=Math.min(tex.height-1,Math.max(0,Math.floor((.5-lat/Math.PI)*tex.height)));
        const offset=(ty*tex.width+tx)*4;
        d[index]=tex.data[offset]*light;d[index+1]=tex.data[offset+1]*light;d[index+2]=tex.data[offset+2]*light;
      }else{d[index]=20*light;d[index+1]=75*light;d[index+2]=120*light;}
      d[index+3]=Math.min(255,(1-dist)*size*180);
    }
    octx.putImageData(pixels,0,0);globeCache.key=key;globeCache.canvas=off;
  }
  const gradient=ctx.createRadialGradient(cx,cy,radius*.96,cx,cy,radius*1.09);
  gradient.addColorStop(0,'rgba(43,150,201,.24)');gradient.addColorStop(1,'rgba(43,150,201,0)');
  ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(cx,cy,radius*1.09,0,Math.PI*2);ctx.fill();
  ctx.drawImage(globeCache.canvas,cx-radius,cy-radius,radius*2,radius*2);
}

function selectSatelliteId(id){state.selectedId=id;highlightSelection();renderSelected();fetchSelectedGeometry();renderFlat()}
function shellColorCss(id){if(!id)return '#eef3fb';const m=String(id).match(/(\d+)/),i=m?Math.max(0,(+m[1]-1)%SHELL_COLORS.length):0;return SHELL_COLORS[i]}
function flatCanvasSize(canvas){if(typeof canvas.getBoundingClientRect!=='function'||typeof canvas.getContext!=='function')return{ctx:null,w:0,h:0,dpr:1};const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr)||1;canvas.height=Math.round(r.height*dpr)||1;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:r.width,h:r.height,dpr}}
const EARTH_R_KM=6378.137;
function ecefToLLA(v){if(!v)return null;const x=+v[0],y=+v[1],z=+v[2],r=Math.hypot(x,y,z);if(!Number.isFinite(r)||r<=1e-6)return null;return{lat:Math.asin(Math.max(-1,Math.min(1,z/r)))*180/Math.PI,lon:Math.atan2(y,x)*180/Math.PI,alt:r-EARTH_R_KM};}
function renderFlat(){
  if(!['2d-globe','2d-map'].includes(state.viewMode))return;const canvas=$('flatCanvas'),{ctx,w,h,dpr}=flatCanvasSize(canvas);if(!w||!h)return;
  ctx.clearRect(0,0,w,h);
  const radius=Math.min(w*.4,h*.43),cx=w/2,cy=h*.46,d=Math.PI/180,map=state.viewMode==='2d-map';
  const sats=state.snapshot?.satellites||[],alts=sats.map(s=>+s.altitude_km).filter(Number.isFinite);
  const viz=state.snapshot?.visualization||{};
  const altMin=alts.length?Math.min(...alts):null,altMax=alts.length?Math.max(...alts):null;
  const altSize=alt=>{if(alt==null||!Number.isFinite(+alt))return 2.6;if(altMax==null||altMax<=altMin)return 3.4;return 2.4+3.2*((+alt-altMin)/(altMax-altMin))};
  const project=(lat,lon,altKm)=>{
    if(map)return{x:18+(lon+180)/360*(w-36),y:20+(90-lat)/180*(h-60),front:true};
    const a=lat*d,b=(lon-state.flatCamera.lon)*d,c=state.flatCamera.lat*d;
    const z=Math.sin(c)*Math.sin(a)+Math.cos(c)*Math.cos(a)*Math.cos(b);
    const rr=altKm==null?radius:radius*(1+Math.min(Math.max(+altKm,0),4000)/EARTH_R_KM);
    return{x:cx+rr*Math.cos(a)*Math.sin(b),y:cy-rr*(Math.cos(c)*Math.sin(a)-Math.sin(c)*Math.cos(a)*Math.cos(b)),front:z>=0};
  };
  if(!map&&$('earthOn').checked&&$('earthStyle').value!=='outline'){ctx.save();ctx.globalAlpha=+$('earthOpacity').value;paintGlobeTexture(ctx,cx,cy,radius,dpr,state.flatCamera.lat,state.flatCamera.lon);ctx.restore();}
  function line(points,color,width=1,dash=[]){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);let prev=null;for(const pt of points){const p=project(pt[0],pt[1],pt[2]);if(p.front){if(!prev||Math.abs(p.x-prev.x)>w/2)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);prev=p;}else prev=null;}ctx.stroke();ctx.setLineDash([]);}
  for(let lat=-60;lat<=60;lat+=30)line(Array.from({length:181},(_,i)=>[lat,-180+i*2]),lat===0?'#34607a':'#25435a',.7);
  for(let lon=-180;lon<180;lon+=30)line(Array.from({length:91},(_,i)=>[-90+i*2,lon]),'#25435a',.7);
  for(const outline of state.worldOutlines)line(outline,'#45758a',.85);
  if($('coverageOn').checked){
    const heatList=(()=>{const src=state.snapshot?.heatmaps||state.snapshot?.heatmap;return Array.isArray(src)?src:(src?[src]:[])})();
    const globalMax=Math.max(0,...heatList.map(hm=>hm?.max_visible||0)),opacity=+$('coverageOpacity').value;
    for(const hm of heatList){
      if(!hm?.visible_counts?.length)continue;
      const rows=hm.visible_counts,latArr=hm.lat_deg,lonArr=hm.lon_deg,feature=state.boundaryFeatureMap.get(String(hm.area_code||'').toUpperCase());
      for(let i=0;i<latArr.length-1;i++)for(let j=0;j<lonArr.length-1;j++){
        const lat0=latArr[i],lat1=latArr[i+1],lon0=lonArr[j],lon1=lonArr[j+1];
        if(feature&&!pointInGeometry((lon0+lon1)/2,(lat0+lat1)/2,feature.geometry))continue;
        const c=heatColor(rows[i][j],globalMax);if(c[3]<=0)continue;
        const corners=[[lat0,lon0],[lat0,lon1],[lat1,lon1],[lat1,lon0]].map(([la,lo])=>project(la,lo));
        if(corners.some(q=>!q.front))continue;
        ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);for(let k=1;k<4;k++)ctx.lineTo(corners[k].x,corners[k].y);ctx.closePath();
        ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${(c[3]/255*opacity).toFixed(3)})`;ctx.fill();
      }
    }
  }
  if(map){ctx.font='11px system-ui';ctx.fillStyle='#7793ae';ctx.textAlign='center';for(let lon=-180;lon<=180;lon+=60){const p=project(0,lon);ctx.fillText(lon+'°',p.x,h-25);}ctx.textAlign='left';for(let lat=-60;lat<=60;lat+=30){const p=project(lat,-180);ctx.fillText(lat+'°',p.x+3,p.y-4);}}
  if($('orbitOn').checked)for(const p of (viz.orbits||[])){
    const pts=(p.ecef_km||[]).map(v=>{const l=ecefToLLA(v);return l?[l.lat,l.lon,l.alt]:null}).filter(Boolean);
    if(pts.length<2)continue;
    line(pts,p.shell_id?shellColorCss(p.shell_id)+'b3':'#5d83a79e',1.1);
  }
  if($('islOn').checked)for(const l of (viz.isl_links||[])){
    const a=ecefToLLA(l.a_ecef_km),b=ecefToLLA(l.b_ecef_km);if(!a||!b)continue;
    line([[a.lat,a.lon,a.alt],[b.lat,b.lon,b.alt]],l.shell_id?shellColorCss(l.shell_id)+'94':'#b88cff9e',1);
  }
  const g=state.selectedGeometry;
  if($('groundTrackOn').checked&&g?.ground_track?.segments_lon_lat_deg?.length)for(const seg of g.ground_track.segments_lon_lat_deg)line(seg.map(x=>[x[1],x[0]]),'#ff9f43',1.5,[4,4]);
  if($('footprintOn').checked&&g?.footprint?.lon_lat_deg?.length){ctx.beginPath();let started=false;for(const [lon,lat] of g.footprint.lon_lat_deg){const p=project(lat,lon);if(!p.front){started=false;continue}if(!started){ctx.moveTo(p.x,p.y);started=true}else ctx.lineTo(p.x,p.y)}ctx.closePath();ctx.fillStyle='#42d3ff22';ctx.fill();ctx.strokeStyle='#42d3ffcc';ctx.lineWidth=1;ctx.stroke();}
  state.flatHitPoints=[];
  for(const s of state.snapshot?.satellites||[]){
    if(s.lat_deg==null||s.lon_deg==null||!Number.isFinite(+s.lat_deg)||!Number.isFinite(+s.lon_deg))continue;
    const p=project(s.lat_deg,s.lon_deg,s.altitude_km);if(!p.front)continue;
    if($('serviceOnly').checked&&!s.service_visible&&s.id!==state.selectedId)continue;
    const selected=s.id===state.selectedId,color=selected?'#ffe26a':s.service_visible?'#48d4f0':shellColorCss(s.shell_id),r=altSize(s.altitude_km);
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,selected?r+2.4:r,0,Math.PI*2);ctx.fill();
    if(selected){ctx.strokeStyle='#ffe26aaa';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+7,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#f7f2d8';ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillText(`${s.name} · ${num(s.altitude_km,0,' km')}`,Math.min(p.x+13,w-140),p.y-10);}
    state.flatHitPoints.push({x:p.x,y:p.y,id:s.id});
  }
  if($('accessOn').checked)for(const l of (viz.access_links||[])){
    if(!l.visible)continue;
    const sat=ecefToLLA(l.satellite_ecef_km);if(!sat)continue;
    line([[l.station_lat_deg,l.station_lon_deg,0],[sat.lat,sat.lon,sat.alt]],'#60e8a3e6',2);
  }
  for(const st of stations()){const p=project(st.lat_deg,st.lon_deg);if(!p.front)continue;ctx.strokeStyle='#d3dbe9';ctx.fillStyle='#e8f4ff';ctx.lineWidth=1.5;ctx.strokeRect(p.x-4,p.y-4,8,8);ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillText(st.name,Math.min(p.x+10,w-65),p.y+14);}
  ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillStyle='#829bb5';ctx.fillText(state.snapshot?fmtTime(state.snapshot.time_sec):'',8,16);
  if(!map){ctx.textAlign='right';ctx.fillText(`중심 ${state.flatCamera.lat.toFixed(0)}°, ${state.flatCamera.lon.toFixed(0)}°`,w-8,16);}
  if(altMax!=null&&altMax>altMin){
    const lx=w-92,ly=h-16;ctx.font='10px system-ui';ctx.fillStyle='#9fb4c8';ctx.textAlign='left';ctx.fillText('고도',lx-24,ly+4);
    [altMin,(altMin+altMax)/2,altMax].forEach((a,i)=>{const x=lx+i*26,r=altSize(a);ctx.beginPath();ctx.fillStyle='#8fa9c4';ctx.arc(x,ly,r,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#9fb4c8';ctx.font='9px system-ui';ctx.textAlign='center';ctx.fillText(Math.round(altMin)+'',lx,ly+14);ctx.fillText(Math.round(altMax)+' km',lx+52,ly+14);
  }
}
function setViewMode(mode){
  if(!['3d','2d','2d-globe','2d-map'].includes(mode))return;
  state.viewMode=mode;$('sceneMode').value=mode;const flat=['2d-globe','2d-map'].includes(mode);
  if(flat)$('mapModeNote').textContent=mode==='2d-globe'?'드래그로 회전 · 위성 클릭으로 선택':'위성 클릭으로 선택';
  $('cesiumContainer').hidden=flat;$('flatCanvas').hidden=!flat;$('flatLegend').hidden=!flat;$('flatModeNote').hidden=!flat;
  $('viewerError').style.display=flat?'none':(state.cesiumFailed?'flex':'');
  for(const id of ['globalView','serviceView','selectedView'])$(id).style.display=flat?'none':'';
  if(flat){$('flatLegendTitle').textContent=mode==='2d-map'?'2D 평면도':'2D 지구본';$('flatLegendSub').textContent=mode==='2d-map'?'점 크기 = 고도 · 위성 클릭으로 선택':'드래그로 회전 · 표면과의 거리·점 크기 = 고도 · 위성 클릭으로 선택';renderFlat();}
  else{state.viewer?.resize?.();state.viewer?.scene.requestRender();}
}
function bindFlatView(){
  const canvas=$('flatCanvas');
  canvas.addEventListener('pointerdown',e=>{state.flatDrag={x:e.clientX,y:e.clientY,lon:state.flatCamera.lon,lat:state.flatCamera.lat,moved:false};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{const d=state.flatDrag;if(!d||state.viewMode!=='2d-globe')return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>4)d.moved=true;state.flatCamera.lon=((d.lon-dx*.4+540)%360)-180;state.flatCamera.lat=Math.max(-80,Math.min(80,d.lat+dy*.3));renderFlat()});
  canvas.addEventListener('pointerup',e=>{const d=state.flatDrag;if(d&&!d.moved){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=state.flatHitPoints.map(p=>({...p,dist:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.dist-b.dist)[0];if(hit&&hit.dist<14)selectSatelliteId(hit.id)}state.flatDrag=null});
  canvas.addEventListener('pointercancel',()=>state.flatDrag=null);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>renderFlat()).observe(canvas);
}
async function loadWorldOutlines(){try{const r=await fetch('/static/world.json');if(r.ok){state.worldOutlines=(await r.json()).lines||[];renderFlat();}}catch(e){console.warn('world.json load failed',e);}}

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
    applySceneMode()
  }

  function isMap2D() {
    return $('sceneMode').value === '2d';
  }

  function applySceneMode() {
    setViewMode($('sceneMode').value || '3d');
    if (['2d-globe','2d-map'].includes(state.viewMode)) return;
    if (!state.viewer) return;
    const flat = isMap2D(), scene = state.viewer.scene;
    state.viewer.camera.cancelFlight();
    // Immediate transitions keep playback and selection in the same scene.
    if (flat) scene.morphTo2D(0);
    else scene.morphTo3D(0);
    $('cesiumContainer').setAttribute('aria-label', flat ? '위성 궤도 2D 지도' : '위성 궤도 3D 지도');
    $('mapModeNote').textContent = flat ? '2D에서는 위성을 점 마커로 표시합니다.' : '드래그로 회전 · 휠로 확대';
    applyEarthDisplay();
    updateSatelliteStyles();
    flyGlobal(true);
  }

  async function applyEarthSource() {
    renderFlat();
    if (!state.viewer) return;
    const seq = ++state.earthSourceSeq;
    const outline = $('earthStyle').value === 'outline';
    const source = outline ? 'outline' : $('earthSource').value;
    $('earthSource').disabled = outline;
    const layers = state.viewer.imageryLayers;
    try {
      let provider;
      if (source === 'online') {
        provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(ARCGIS, {
          enablePickFeatures: false
        })
      } else {
        provider = await Cesium.SingleTileImageryProvider.fromUrl(outline ? OUTLINE_EARTH : OFFLINE_EARTH, {
          rectangle: Cesium.Rectangle.MAX_VALUE,
          credit: outline ? 'Natural Earth · public domain' : 'NASA Blue Marble / K-LEO offline texture'
        })
      }
      // An older request must never replace the user's latest selection.
      if (seq !== state.earthSourceSeq) return;
      const previous = state.baseLayer;
      state.baseLayer = layers.addImageryProvider(provider, 0);
      if (previous) layers.remove(previous, true);
      applyEarthDisplay();
      setStatus(outline ? '윤곽 지도를 표시합니다.' : '지구 그림을 표시합니다.', 'good');
      return true;
    } catch (e) {
      if (seq !== state.earthSourceSeq) return;
      if (source === 'online') {
        $('earthSource').value = 'offline';
        const loaded = await applyEarthSource();
        if (!loaded || state.earthSourceSeq !== seq + 1) return;
        setStatus('Online Earth unavailable; switched to offline Blue Marble.', 'warn');
        return
      }
      setStatus('Earth imagery error: ' + e.message, 'bad')
    }
  }

  function applyEarthDisplay() {
    renderFlat();
    if (!state.viewer) return;
    const g = state.viewer.scene.globe;
    g.show = $('earthOn').checked;
    const a = +$('earthOpacity').value;
    // Globe translucency is a 3D effect; dim the base imagery in 2D.
    g.baseColor = Cesium.Color.fromCssColorString('#07111f');
    g.translucency.enabled = !isMap2D() && a < 0.999;
    g.translucency.frontFaceAlpha = a;
    g.translucency.backFaceAlpha = Math.min(a, .75);
    if (state.baseLayer) state.baseLayer.alpha = isMap2D() ? a : 1;
    $('earthOpacityValue').textContent = a.toFixed(2);
    updatePointOcclusion();
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
    const pointMode = isMap2D() || $('satRender').value === 'point',
      camera = state.viewer.camera.positionWC;
    for (const [id, e] of state.satEntities) {
      if (pointMode) {
        const occluded = !isMap2D() && +$('earthOpacity').value >= .999 &&
          e._kleoPosition && isEarthOccluded(camera, e._kleoPosition);
        e.point.show = !occluded;
        e.label.show = !occluded && id === state.selectedId
      } else {
        e.point.show = false;
        e.label.show = id === state.selectedId
      }
    }
  }

  function updateSatelliteStyles() {
    renderFlat();
    const sz = satVisualSize(),
      model = !isMap2D() && $('satRender').value === 'model',
      modelUri = selectedSatModel();
    $('satSizeValue').textContent = sz.toFixed(2) + '×';
    $('satModel').disabled = !model;
    $('satRender').disabled = isMap2D();
    for (const [id, e] of state.satEntities) {
      e.show = !$('serviceOnly').checked || e._kleoServiceVisible === true;
      e.model.show = model;
      e.model.uri = modelUri;
      e.point.disableDepthTestDistance = 0;
      e.label.disableDepthTestDistance = 0;
      e.label.show = model && id === state.selectedId
    }
    highlightSelection()
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
      e._kleoServiceVisible = s.service_visible === true;
      e._kleoPointColor = pointBase
    }
    for (const [id, e] of [...state.satEntities])
      if (!seen.has(id)) {
        state.viewer.entities.remove(e);
        state.satEntities.delete(id)
      } updateSatelliteStyles();
    $('serviceVisibleCount').textContent = `${sats.filter(s => s.service_visible === true).length} / ${sats.length}기`;
    $('nextServiceSatellite').disabled = !sats.some(s => s.service_visible === true && state.satEntities.has(s.id));
  }

  function highlightSelection() {
    const sz = satVisualSize();
    const muted = Cesium.Color.fromCssColorString('#697586').withAlpha(.45);
    for (const [id, e] of state.satEntities) {
      const sel = id === state.selectedId;
      const active = e._kleoServiceVisible;
      e.model.minimumPixelSize = (sel ? 11 : active ? 9 : 5) * sz;
      e.point.pixelSize = (sel ? 8 : active ? 6 : 3) * sz;
      e.model.silhouetteColor = sel ? Cesium.Color.YELLOW : Cesium.Color.CYAN;
      e.model.silhouetteSize = sel ? 2.5 : active ? 1.5 : 0;
      e.model.color = sel ? Cesium.Color.fromCssColorString('#ffe26a') : active ? (e._kleoBaseColor || Cesium.Color.WHITE) : muted;
      e.point.color = sel ? Cesium.Color.YELLOW : active ? (e._kleoPointColor || Cesium.Color.CYAN) : muted
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
    const paths = viz?.orbits || [];
    $('statOrbit').textContent = paths.length;
    updateLineCollection('orbitCollection', $('orbitOn').checked ? paths : [], p => ({
      positions: p.ecef_km.map(ecefCart),
      width: 1.25,
      color: p.shell_id ? shellColor(p.shell_id, .7) : Cesium.Color.fromCssColorString('#5d83a7').withAlpha(.62)
    }))
  }

  function updateLineCollection(name, rows, style) {
    if (!rows.length) {
      clearPrimitive(name);
      return;
    }
    let collection = state[name];
    if (!collection) collection = state[name] = state.viewer.scene.primitives.add(new Cesium.PolylineCollection());
    for (let i = 0; i < rows.length; i++) {
      const spec = style(rows[i]);
      if (i < collection.length) {
        const line = collection.get(i);
        line.positions = spec.positions;
        line.width = spec.width;
        line.material.uniforms.color = spec.color;
      } else {
        collection.add({ positions: spec.positions, width: spec.width,
          material: Cesium.Material.fromType('Color', { color: spec.color }) });
      }
    }
    while (collection.length > rows.length) collection.remove(collection.get(collection.length - 1));
  }

  function renderIsl(viz) {
    const links = viz?.isl_links || [];
    $('statIsl').textContent = links.length;
    updateLineCollection('islCollection', $('islOn').checked ? links : [], l => ({
      positions: [ecefCart(l.a_ecef_km), ecefCart(l.b_ecef_km)],
      width: 1.1,
      color: l.shell_id ? shellColor(l.shell_id, .58) : Cesium.Color.fromCssColorString('#b88cff').withAlpha(.62)
    }))
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
    const links = (viz?.access_links || []).filter(x => x.visible);
    $('statAccess').textContent = links.length;
    reconcileGroundStations(viz);
    updateLineCollection('accessCollection', $('accessOn').checked ? links : [], l => ({
      positions: [ecefCart(l.station_ecef_km), ecefCart(l.satellite_ecef_km)],
      width: 2,
      color: Cesium.Color.fromCssColorString('#60e8a3').withAlpha(.9)
    }))
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
    h += prop('서비스 가시성', s.service_visible ? `가능 · ${s.service_station_count}개 관측 도시` : '조건 미충족');
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
    state.selectedGeometry = null;
    renderFlat();
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
    state.selectedGeometry = g;
    renderFlat();
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
    renderFlat();
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
    state.snapshotSeq++;
    state.snapshotController?.abort();
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
    const destination = isMap2D() ? Cesium.Rectangle.MAX_VALUE :
      Cesium.Cartesian3.fromDegrees(GLOBAL_VIEW.lon, GLOBAL_VIEW.lat, GLOBAL_VIEW.height);
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
    // Playback reads the latest layer controls on its next frame. A separate
    // request here would abort its active frame and break the playback loop.
    if (state.snapshot && !state.playing) return fetchSnapshot(+$('timeSlider').value, true)
  }

  function selectNextServiceSatellite() {
    const candidates = (state.snapshot?.satellites || []).filter(s => s.service_visible && state.satEntities.has(s.id));
    if (!candidates.length) return;
    const index = candidates.findIndex(s => s.id === state.selectedId);
    state.selectedId = candidates[(index + 1) % candidates.length].id;
    highlightSelection();
    renderSelected();
    fetchSelectedGeometry(true);
    renderFlat();
    flySelected();
  }

  function bind() {
    $('mode').addEventListener('change', setModeUI);
    $('openMultiShellBtn').addEventListener('click', () => {
      $('mode').value = 'multi_shell';
      setModeUI();
      setSettingsExpanded(true);
      $('shellList').querySelector('.sh-name')?.focus();
    });
    $('addShellBtn').addEventListener('click', () => {
      const card = addShell({});
      invalidateAnalysis();
      invalidatePreview();
      card.querySelector('.sh-name').focus();
    });
    $('runBtn').addEventListener('click', runAnalysis);
    $('tradeBtn').addEventListener('click', runTrade);
    $('tleParseBtn').addEventListener('click', parseTLE);
    $('tleExampleBtn').addEventListener('click', () => {
      $('tleText').value = verificationTLE;
      invalidateAnalysis();
      invalidatePreview();
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
    $('earthStyle').addEventListener('change', applyEarthSource);
    $('sceneMode').addEventListener('change', applySceneMode);
    $('earthOpacity').addEventListener('input', applyEarthDisplay);
    $('satSize').addEventListener('input', updateSatelliteStyles);
    $('satRender').addEventListener('change', updateSatelliteStyles);
    $('serviceOnly').addEventListener('change', updateSatelliteStyles);
    $('nextServiceSatellite').addEventListener('click', selectNextServiceSatellite);
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
      for (const layer of state.coverageLayers) layer.alpha = a;
      renderFlat();
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
  }

  async function bootstrap() {
    initShells();
    bind();
    bindRelease();
    bindWorkspaces();
    bindFlatView();
    loadEarthTexture();
    loadWorldOutlines();
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
      state.cesiumFailed = true;
      if (!['2d-globe','2d-map'].includes(state.viewMode)) $('viewerError').style.display = 'flex';
      $('viewerError').innerHTML = `<div><b>3D 지도를 불러오지 못했습니다.</b><br><br>${esc(e.message)}<br><br>네트워크 연결 또는 로컬 지도 자산을 확인한 뒤 새로고침하세요.</div>`;
      setStatus('3D 지도를 불러오지 못했습니다. 상세 분석은 계속 사용할 수 있습니다.', 'bad');
    }
  }
  bootstrap();
})();
