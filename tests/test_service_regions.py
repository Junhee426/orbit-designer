from app.core.service_regions import catalog_payload, resolve_selection


def test_service_catalog_has_kleo_target_regions():
    payload = catalog_payload()
    codes = {x["code"] for x in payload["countries"]}
    assert {"KOR", "JPN", "ARE", "SAU", "SGP", "IDN", "PHL", "VNM", "THA"} <= codes
    region_codes = {x["code"] for x in payload["regions"]}
    assert {"KLEO_CORE", "SEA", "MIDDLE_EAST", "KLEO_EXPANDED"} <= region_codes


def test_resolve_multicountry_creates_independent_coverage_areas_and_cities():
    r = resolve_selection(["KOR", "ARE", "SGP"], cities_per_country=2)
    assert r["country_codes"] == ["KOR", "ARE", "SGP"]
    assert len(r["coverage_areas"]) == 3
    assert len(r["stations"]) == 5  # Korea 2 + UAE 2 + Singapore 1
    assert {x["name"] for x in r["stations"]} >= {"Seoul", "Dubai", "Singapore"}
    assert r["camera_bounds"]["lon_min"] < 60
    assert r["camera_bounds"]["lon_max"] > 120


def test_region_and_country_multiselect_deduplicates_codes():
    r = resolve_selection(["KOR"], ["NE_ASIA", "KLEO_CORE"], cities_per_country=1)
    assert r["country_codes"].count("KOR") == 1
    assert {"KOR", "JPN", "ARE", "SGP"} <= set(r["country_codes"])
