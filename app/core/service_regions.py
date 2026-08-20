from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class ServiceCity:
    name: str
    lat_deg: float
    lon_deg: float


@dataclass(frozen=True)
class ServiceCountry:
    code: str
    name: str
    name_ko: str
    region: str
    bbox: tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max
    cities: tuple[ServiceCity, ...]


# The catalog is intentionally focused on the K-LEO target arc (Northeast Asia,
# Southeast Asia and the Middle East).  Bboxes are analysis envelopes; the UI
# overlays Natural Earth Admin-0 geometry and masks the heatmap visually when
# that boundary dataset is available.
COUNTRIES: dict[str, ServiceCountry] = {
    "KOR": ServiceCountry("KOR", "South Korea", "대한민국", "Northeast Asia", (126.0, 33.0, 130.0, 39.0), (
        ServiceCity("Seoul", 37.5665, 126.9780), ServiceCity("Busan", 35.1796, 129.0756), ServiceCity("Jeju", 33.4996, 126.5312))),
    "JPN": ServiceCountry("JPN", "Japan", "일본", "Northeast Asia", (128.5, 30.0, 146.5, 46.5), (
        ServiceCity("Tokyo", 35.6762, 139.6503), ServiceCity("Osaka", 34.6937, 135.5023), ServiceCity("Fukuoka", 33.5902, 130.4017))),
    "ARE": ServiceCountry("ARE", "United Arab Emirates", "아랍에미리트", "Middle East", (51.4, 22.3, 56.6, 26.3), (
        ServiceCity("Dubai", 25.2048, 55.2708), ServiceCity("Abu Dhabi", 24.4539, 54.3773), ServiceCity("Fujairah", 25.1288, 56.3265))),
    "SAU": ServiceCountry("SAU", "Saudi Arabia", "사우디아라비아", "Middle East", (34.3, 16.0, 55.9, 32.5), (
        ServiceCity("Riyadh", 24.7136, 46.6753), ServiceCity("Jeddah", 21.4858, 39.1925), ServiceCity("Dammam", 26.4207, 50.0888))),
    "OMN": ServiceCountry("OMN", "Oman", "오만", "Middle East", (51.8, 16.4, 59.9, 26.6), (
        ServiceCity("Muscat", 23.5880, 58.3829), ServiceCity("Salalah", 17.0190, 54.0897))),
    "QAT": ServiceCountry("QAT", "Qatar", "카타르", "Middle East", (50.7, 24.3, 51.8, 26.3), (
        ServiceCity("Doha", 25.2854, 51.5310),)),
    "KWT": ServiceCountry("KWT", "Kuwait", "쿠웨이트", "Middle East", (46.4, 28.4, 48.6, 30.2), (
        ServiceCity("Kuwait City", 29.3759, 47.9774),)),
    "BHR": ServiceCountry("BHR", "Bahrain", "바레인", "Middle East", (50.3, 25.7, 50.9, 26.4), (
        ServiceCity("Manama", 26.2235, 50.5876),)),
    "SGP": ServiceCountry("SGP", "Singapore", "싱가포르", "Southeast Asia", (103.55, 1.10, 104.10, 1.55), (
        ServiceCity("Singapore", 1.3521, 103.8198),)),
    "IDN": ServiceCountry("IDN", "Indonesia", "인도네시아", "Southeast Asia", (94.5, -11.5, 141.5, 6.5), (
        ServiceCity("Jakarta", -6.2088, 106.8456), ServiceCity("Surabaya", -7.2575, 112.7521), ServiceCity("Makassar", -5.1477, 119.4327))),
    "PHL": ServiceCountry("PHL", "Philippines", "필리핀", "Southeast Asia", (116.5, 4.5, 127.0, 20.5), (
        ServiceCity("Manila", 14.5995, 120.9842), ServiceCity("Cebu", 10.3157, 123.8854), ServiceCity("Davao", 7.1907, 125.4553))),
    "VNM": ServiceCountry("VNM", "Vietnam", "베트남", "Southeast Asia", (101.5, 8.0, 110.2, 24.0), (
        ServiceCity("Hanoi", 21.0278, 105.8342), ServiceCity("Ho Chi Minh City", 10.8231, 106.6297), ServiceCity("Da Nang", 16.0544, 108.2022))),
    "THA": ServiceCountry("THA", "Thailand", "태국", "Southeast Asia", (96.5, 5.0, 106.5, 21.0), (
        ServiceCity("Bangkok", 13.7563, 100.5018), ServiceCity("Chiang Mai", 18.7883, 98.9853), ServiceCity("Phuket", 7.8804, 98.3923))),
    "MYS": ServiceCountry("MYS", "Malaysia", "말레이시아", "Southeast Asia", (99.0, 0.5, 119.5, 7.8), (
        ServiceCity("Kuala Lumpur", 3.1390, 101.6869), ServiceCity("Kota Kinabalu", 5.9804, 116.0735), ServiceCity("Kuching", 1.5533, 110.3592))),
    "BRN": ServiceCountry("BRN", "Brunei", "브루나이", "Southeast Asia", (114.0, 4.0, 115.5, 5.2), (
        ServiceCity("Bandar Seri Begawan", 4.9031, 114.9398),)),
    "KHM": ServiceCountry("KHM", "Cambodia", "캄보디아", "Southeast Asia", (102.0, 10.0, 108.0, 15.0), (
        ServiceCity("Phnom Penh", 11.5564, 104.9282), ServiceCity("Siem Reap", 13.3671, 103.8448))),
    "LAO": ServiceCountry("LAO", "Laos", "라오스", "Southeast Asia", (100.0, 13.5, 108.0, 23.0), (
        ServiceCity("Vientiane", 17.9757, 102.6331), ServiceCity("Luang Prabang", 19.8833, 102.1333))),
    "MMR": ServiceCountry("MMR", "Myanmar", "미얀마", "Southeast Asia", (91.0, 9.0, 102.0, 29.0), (
        ServiceCity("Yangon", 16.8409, 96.1735), ServiceCity("Mandalay", 21.9588, 96.0891), ServiceCity("Naypyidaw", 19.7633, 96.0785))),
}

REGIONS: dict[str, dict] = {
    "KLEO_CORE": {"name": "K-LEO Core", "name_ko": "K-LEO 핵심", "countries": ["KOR", "ARE", "SGP"]},
    "NE_ASIA": {"name": "Korea + Japan", "name_ko": "한·일", "countries": ["KOR", "JPN"]},
    "SEA": {"name": "Southeast Asia", "name_ko": "동남아", "countries": ["SGP", "IDN", "PHL", "VNM", "THA", "MYS", "BRN", "KHM", "LAO", "MMR"]},
    "MIDDLE_EAST": {"name": "Middle East", "name_ko": "중동", "countries": ["ARE", "SAU", "OMN", "QAT", "KWT", "BHR"]},
    "KLEO_EXPANDED": {"name": "K-LEO Expanded", "name_ko": "K-LEO 확대", "countries": ["KOR", "JPN", "ARE", "SAU", "OMN", "QAT", "KWT", "BHR", "SGP", "IDN", "PHL", "VNM", "THA", "MYS"]},
}


def _country_payload(c: ServiceCountry) -> dict:
    return {
        "code": c.code,
        "name": c.name,
        "name_ko": c.name_ko,
        "region": c.region,
        "bbox": list(c.bbox),
        "cities": [{"name": x.name, "lat_deg": x.lat_deg, "lon_deg": x.lon_deg} for x in c.cities],
    }


def catalog_payload() -> dict:
    countries = [_country_payload(COUNTRIES[k]) for k in sorted(COUNTRIES, key=lambda x: (COUNTRIES[x].region, COUNTRIES[x].name))]
    regions = [{"code": code, **value} for code, value in REGIONS.items()]
    return {"countries": countries, "regions": regions}


def expand_selection(country_codes: Iterable[str] = (), region_codes: Iterable[str] = ()) -> list[str]:
    result: list[str] = []
    for region_code in region_codes:
        region = REGIONS.get(str(region_code).upper())
        if region:
            for code in region["countries"]:
                if code not in result:
                    result.append(code)
    for code in country_codes:
        code = str(code).upper()
        if code in COUNTRIES and code not in result:
            result.append(code)
    return result


def resolve_selection(country_codes: Iterable[str] = (), region_codes: Iterable[str] = (), cities_per_country: int = 3) -> dict:
    codes = expand_selection(country_codes, region_codes)
    if not codes:
        codes = ["KOR"]
    cities_per_country = max(1, min(5, int(cities_per_country)))
    selected = [COUNTRIES[c] for c in codes]
    coverage_areas = [{
        "code": c.code,
        "name": c.name,
        "name_ko": c.name_ko,
        "lon_min": c.bbox[0],
        "lat_min": c.bbox[1],
        "lon_max": c.bbox[2],
        "lat_max": c.bbox[3],
    } for c in selected]
    stations = []
    for c in selected:
        for city in c.cities[:cities_per_country]:
            stations.append({"name": city.name, "country_code": c.code, "lat_deg": city.lat_deg, "lon_deg": city.lon_deg})
    lon_min = min(c.bbox[0] for c in selected)
    lat_min = min(c.bbox[1] for c in selected)
    lon_max = max(c.bbox[2] for c in selected)
    lat_max = max(c.bbox[3] for c in selected)
    return {
        "country_codes": codes,
        "countries": [_country_payload(c) for c in selected],
        "coverage_areas": coverage_areas,
        "stations": stations,
        "camera_bounds": {"lon_min": lon_min, "lat_min": lat_min, "lon_max": lon_max, "lat_max": lat_max},
    }
