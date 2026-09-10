from pathlib import Path


HTML = Path("app/static/index.html").read_text(encoding="utf-8")
JS = Path("app/static/app.js").read_text(encoding="utf-8")


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


def test_v14_ui_offers_walker_tle_and_online_offline_earth_options():
    assert 'value="walker"' in HTML
    assert 'value="tle"' in HTML
    assert 'value="offline"' in HTML
    assert 'value="online"' in HTML
    # Provider selection, fallback and rendering behavior are covered by
    # frontend_ui.cjs (applyEarthSource / applyEarthDisplay / renderOrbits
    # etc.), which calls the real functions instead of grepping formatted
    # source text.


def test_v14_ui_wires_service_region_selection_to_the_map():
    # country/region resolution, boundary source selection and the
    # point-in-polygon heat-map mask are behaviorally covered by
    # frontend_ui.cjs (ensureBoundaryData / pointInGeometry / flyServiceArea)
    # and frontend_workspaces.cjs. What remains worth pinning here is that
    # the wiring itself -- not just the standalone functions -- still exists.
    assert "coverageAreas()" in JS
    assert "GeoJsonDataSource.load" in JS


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


def test_v141_satellite_point_markers_are_wired_to_earth_occlusion():
    # The occlusion geometry itself (front-of-Earth visible, behind-Earth
    # hidden, disabled while earthOn is off) is covered by
    # tests/test_occlusion_js.py, and the point/label config shape (no
    # outline, disableDepthTestDistance:0) by frontend_ui.cjs. What those
    # don't cover is that the per-frame update loop is actually wired up.
    assert "preRender.addEventListener(updatePointOcclusion)" in JS


def test_v15_global_initial_view_and_service_selection_do_not_auto_zoom():
    # GLOBAL_VIEW's exact lon/lat/height and the instant-vs-animated camera
    # call are covered behaviorally by frontend_ui.cjs (flyGlobal). Startup
    # not running an analysis is covered by frontend_workspaces.cjs
    # (bootstrap only requests /api/snapshot). What remains is that the
    # viewer bootstrap sequence and the manual-recenter buttons are wired.
    assert "await applyEarthSource()" in JS
    assert "applyEarthDisplay()" in JS
    assert "flyGlobal(true)" in JS
    assert "$('applyServiceBtn')" in JS and "applyServiceSelection(false)" in JS
    assert "$('globalView')" in JS and "flyGlobal(false)" in JS
    assert "$('serviceView')" in JS and "flyServiceArea" in JS


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
    ]:
        assert token in HTML
    # /api/multi-shell/simulate, /api/orbital-geometry, fetchSelectedGeometry
    # and the trade-study/TLE mode gating in setModeUI() are behaviorally
    # covered by frontend_ui.cjs.
