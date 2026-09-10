from pathlib import Path


HTML = Path("app/static/index.html").read_text(encoding="utf-8")


def test_v14_requested_controls_are_present():
    for control_id in [
        'id="mode"', 'id="tleText"', 'id="cesiumContainer"',
        'id="earthOn"', 'id="earthSource"', 'id="earthOpacity"',
        'id="satSize"', 'id="satRender"', 'id="satModel"', 'id="orbitOn"',
        'id="islOn"', 'id="accessOn"', 'id="coverageOn"',
        'id="coverageOpacity"', 'id="timeSlider"', 'id="playBtn"',
        'id="heatmap"', 'id="satDetails"', 'id="regionPresets"',
        'id="countryList"', 'id="applyServiceBtn"', 'id="serviceView"',
    ]:
        assert control_id in HTML


def test_v14_ui_contains_cesium_online_offline_and_model_layers():
    assert 'value="walker"' in HTML
    assert 'value="tle"' in HTML
    assert 'value="offline"' in HTML
    assert 'value="online"' in HTML
    assert 'earth_blue_marble_2048.jpg' in HTML
    assert 'kleo_satellite.glb' in HTML
    assert 'ArcGisMapServerImageryProvider' in HTML
    assert 'SingleTileImageryProvider' in HTML
    assert 'PolylineCollection' in HTML
    assert 'translucency.enabled' in HTML


def test_v14_ui_contains_multicountry_region_logic():
    for token in [
        "/api/service-regions/catalog", "/api/service-regions/resolve",
        "coverage_areas:coverageAreas()", "GeoJsonDataSource.load",
        "pointInGeometry", "flyServiceArea", "Natural Earth 50m",
    ]:
        assert token in HTML


def test_service_controls_and_results_belong_to_analysis_workspace():
    from html.parser import HTMLParser

    class WorkspaceParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack = []
            self.controls = {}

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            view = attrs.get('data-view', self.stack[-1][1] if self.stack else None)
            if 'id' in attrs:
                assert attrs['id'] not in self.controls, 'Duplicate control ID'
                self.controls[attrs['id']] = view
            if tag not in {'input', 'meta', 'link', 'br', 'hr'}:
                self.stack.append((tag, view))

        def handle_endtag(self, tag):
            if self.stack and self.stack[-1][0] == tag:
                self.stack.pop()

    parser = WorkspaceParser()
    parser.feed(HTML)
    for control in ['regionPresets', 'countryList', 'runBtn', 'coverage', 'resultTable', 'exportJsonBtn']:
        assert parser.controls[control] == 'analysis'
    for control in ['cesiumContainer', 'previewBtn', 'satDetails', 'orbitSatCount']:
        assert parser.controls[control] == 'orbit'
    assert '<body data-workspace="orbit">' in HTML
    assert parser.controls['status'] is None


def test_v141_satellite_point_markers_use_earth_occlusion():
    assert 'disableDepthTestDistance:0' in HTML
    assert 'function isEarthOccluded(camera,sat)' in HTML
    assert 'function updatePointOcclusion()' in HTML
    assert 'v.scene.preRender.addEventListener(updatePointOcclusion)' in HTML
    assert 'e._kleoPosition=pos' in HTML
    # The satellite point/label block must no longer force through-Earth rendering.
    satellite_block = HTML[HTML.index("point:{pixelSize:9,color:pointBase"):HTML.index("e._kleoSatelliteId=s.id")]
    assert 'Number.POSITIVE_INFINITY' not in satellite_block


def test_v142_point_markers_have_no_outline_and_model_selector_is_wired():
    satellite_block = HTML[HTML.index("point:{pixelSize:9,color:pointBase"):HTML.index("e._kleoSatelliteId=s.id")]
    assert 'outlineColor:' not in satellite_block
    assert 'outlineWidth:' not in satellite_block
    assert 'const SAT_MODELS=' in HTML
    assert "kleo_satellite_compact.glb" in HTML
    assert "kleo_satellite_broadband.glb" in HTML
    assert "kleo_satellite_flatpanel.glb" in HTML
    assert "$('satModel').addEventListener('change',updateSatelliteStyles)" in HTML
    assert "e.model.uri=modelUri" in HTML
    assert "$('satModel').disabled=!model" in HTML


def test_v15_global_initial_view_and_service_selection_do_not_auto_zoom():
    assert 'const GLOBAL_VIEW={lon:100,lat:20,height:24000000}' in HTML
    assert 'function flyGlobal(instant=false)' in HTML
    assert 'state.viewer.camera.setView({destination})' in HTML
    assert 'await applyEarthSource();applyEarthDisplay();flyGlobal(true)' in HTML
    assert 'await refreshPreview();flyGlobal(true)' in HTML
    bootstrap = HTML[HTML.index('async function bootstrap(){'):]
    assert 'await runAnalysis()' not in bootstrap
    assert "$('applyServiceBtn').addEventListener('click',()=>applyServiceSelection(false))" in HTML
    assert 'updatePresetStates();applyServiceSelection(false)' in HTML
    assert "$('globalView').addEventListener('click',()=>flyGlobal(false))" in HTML
    assert "$('serviceView').addEventListener('click',flyServiceArea)" in HTML


def test_v110_brand_and_walker_defaults_are_consistent():
    assert '<title>Test Orbit Designer V1.2.0</title>' in HTML
    assert '<div class="brand">Test Orbit Designer</div>' in HTML
    assert '<div class="version">V1.2.0 · 위성군 설계 워크스페이스</div>' in HTML
    assert 'id="alt" type="number" value="1280"' in HTML
    assert 'id="planes" type="number" value="8"' in HTML
    assert 'id="spp" type="number" value="16"' in HTML


def test_v110_orbital_analysis_controls_and_multishell_ui_are_present():
    for token in [
        'value="multi_shell"', 'id="multiShellFields"', 'id="shellList"', 'id="addShellBtn"',
        'id="groundTrackOn"', 'id="footprintOn"', 'id="trackSpan"',
        '/api/multi-shell/simulate', '/api/orbital-geometry', 'function fetchSelectedGeometry',
    ]:
        assert token in HTML
    assert "$('tradeBtn').disabled=state.analysisBusy||m!=='walker'" in HTML
