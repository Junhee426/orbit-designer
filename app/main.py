from pathlib import Path
import math
import os
import time
from typing import List, Literal, Optional
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .core.models import ConstellationConfig, GroundStation, LinkBudgetConfig, SimulationConfig
from .core.optimizer import trade_study
from .core.simulation import run_simulation
from .core.snapshot import tle_snapshot, tle_station_timelines, walker_snapshot
from .core.service_regions import catalog_payload, resolve_selection
from .core.tle import SGP4UnavailableError, TLEParseError, parse_tle_text, sgp4_available
from .server_config import SETTINGS

BASE = Path(__file__).resolve().parent
APP_NAME = "Test Orbit Designer"
APP_VERSION = "1.0.0"
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Render-ready LEO satellite communications constellation design service.",
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.middleware("http")
async def production_headers(request: Request, call_next):
    started = time.perf_counter()
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - started) * 1000.0:.1f}"
    if request.url.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", f"public, max-age={SETTINGS.static_cache_seconds}")
    else:
        response.headers.setdefault("Cache-Control", "no-store")
    return response


class StationIn(BaseModel):
    name: str
    lat_deg: float
    lon_deg: float
    min_elevation_deg: float = 20.0


class CoverageAreaIn(BaseModel):
    code: str = "CUSTOM"
    name: str = "Service area"
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float


class ServiceSelectionIn(BaseModel):
    country_codes: List[str] = []
    region_codes: List[str] = []
    cities_per_country: int = Field(3, ge=1, le=5)
    min_elevation_deg: float = Field(20.0, ge=-5.0, le=90.0)


class SimIn(BaseModel):
    altitude_km: float = 1280.0
    inclination_deg: float = 42.0
    planes: int = Field(8, ge=1, le=128)
    sats_per_plane: int = Field(16, ge=1, le=256)
    phasing: int = 1
    j2: bool = True
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(60.0, gt=0, le=3600)
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]


class TLESimIn(BaseModel):
    tle_text: str = Field(min_length=1, max_length=SETTINGS.max_tle_chars)
    start_utc: Optional[str] = None
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(60.0, gt=0, le=3600)
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
    ]


class SnapshotIn(BaseModel):
    mode: Literal["walker", "tle"] = "walker"
    time_sec: float = Field(0.0, ge=0.0, le=604800.0)
    min_elevation_deg: float = Field(20.0, ge=-5.0, le=90.0)
    heatmap: bool = True
    heatmap_points: int = Field(28, ge=4, le=80)
    include_orbits: bool = True
    include_isl: bool = True
    include_access: bool = True
    orbit_samples: int = Field(96, ge=24, le=360)
    coverage_areas: List[CoverageAreaIn] = []
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]

    # Walker fields
    altitude_km: float = 1280.0
    inclination_deg: float = 42.0
    planes: int = Field(8, ge=1, le=128)
    sats_per_plane: int = Field(16, ge=1, le=256)
    phasing: int = 1
    j2: bool = True

    # TLE fields
    tle_text: Optional[str] = Field(None, max_length=SETTINGS.max_tle_chars)
    start_utc: Optional[str] = None


class TLEParseIn(BaseModel):
    tle_text: str = Field(min_length=1, max_length=SETTINGS.max_tle_chars)


class TradeIn(BaseModel):
    altitudes_km: List[float] = [1000, 1280, 1500]
    inclinations_deg: List[float] = [42, 53]
    planes_list: List[int] = [4, 8]
    sats_per_plane_list: List[int] = [12, 16]
    phasing: int = 1
    duration_min: float = 120.0
    step_sec: float = 180.0
    min_availability: float = 0.95
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]


def station_objs(items):
    return [GroundStation(x.name, x.lat_deg, x.lon_deg, x.min_elevation_deg) for x in items]


def constellation_from(req) -> ConstellationConfig:
    if req.altitude_km < 160 or req.altitude_km > 3000:
        raise HTTPException(400, "This LEO-focused Walker mode supports 160-3000 km altitude.")
    return ConstellationConfig(
        req.altitude_km,
        req.inclination_deg,
        req.planes,
        req.sats_per_plane,
        req.phasing,
        req.j2,
    )


def _sample_count(duration_min: float, step_sec: float) -> int:
    return int(math.floor(duration_min * 60.0 / step_sec)) + 1


def _enforce_station_count(stations: List[StationIn]) -> None:
    if len(stations) > SETTINGS.max_stations:
        raise HTTPException(413, f"Too many stations: {len(stations)} > {SETTINGS.max_stations}.")


def _enforce_walker_limits(req, *, snapshot: bool = False) -> int:
    count = int(req.planes) * int(req.sats_per_plane)
    if count > SETTINGS.max_satellites:
        raise HTTPException(413, f"Constellation has {count} satellites; server limit is {SETTINGS.max_satellites}.")
    stations = list(getattr(req, "stations", []) or [])
    _enforce_station_count(stations)
    if snapshot:
        areas = list(getattr(req, "coverage_areas", []) or [])
        if len(areas) > SETTINGS.max_coverage_areas:
            raise HTTPException(413, f"Too many coverage areas: {len(areas)} > {SETTINGS.max_coverage_areas}.")
        hp = int(getattr(req, "heatmap_points", 0) or 0)
        if hp > SETTINGS.max_heatmap_points:
            raise HTTPException(413, f"Heat-map resolution {hp} exceeds server limit {SETTINGS.max_heatmap_points}.")
        if bool(getattr(req, "heatmap", False)):
            area_count = max(1, len(areas))
            work = count * hp * hp * area_count
            if work > SETTINGS.max_snapshot_work:
                raise HTTPException(413, f"Snapshot workload {work:,} exceeds server limit {SETTINGS.max_snapshot_work:,}.")
    return count


def _enforce_sim_limits(req, satellite_count: int) -> None:
    samples = _sample_count(float(req.duration_min), float(req.step_sec))
    if samples > SETTINGS.max_sim_samples:
        raise HTTPException(413, f"Simulation has {samples} time samples; server limit is {SETTINGS.max_sim_samples}.")
    station_count = max(1, len(req.stations))
    work = satellite_count * samples * station_count
    if work > SETTINGS.max_sim_work:
        raise HTTPException(413, f"Simulation workload {work:,} exceeds server limit {SETTINGS.max_sim_work:,}.")


def _enforce_tle_records(records) -> int:
    count = len(records)
    if count > SETTINGS.max_tle_satellites:
        raise HTTPException(413, f"TLE set contains {count} satellites; server limit is {SETTINGS.max_tle_satellites}.")
    return count


def _parse_tles_guarded(tle_text: str):
    try:
        records = parse_tle_text(tle_text)
    except TLEParseError as exc:
        raise HTTPException(400, str(exc)) from exc
    _enforce_tle_records(records)
    return records


def _enforce_trade_limits(req: TradeIn) -> None:
    cases = len(req.altitudes_km) * len(req.inclinations_deg) * len(req.planes_list) * len(req.sats_per_plane_list)
    if cases > SETTINGS.max_trade_cases:
        raise HTTPException(413, f"Trade study has {cases} cases; server limit is {SETTINGS.max_trade_cases}.")
    _enforce_station_count(req.stations)
    samples = _sample_count(float(req.duration_min), float(req.step_sec))
    if samples > SETTINGS.max_sim_samples:
        raise HTTPException(413, f"Trade study has {samples} time samples per case; server limit is {SETTINGS.max_sim_samples}.")
    total_work = 0
    for p in req.planes_list:
        for s in req.sats_per_plane_list:
            sats = int(p) * int(s)
            if sats > SETTINGS.max_satellites:
                raise HTTPException(413, f"Trade-study constellation has {sats} satellites; server limit is {SETTINGS.max_satellites}.")
            total_work += sats * len(req.altitudes_km) * len(req.inclinations_deg) * samples * max(1, len(req.stations))
    if total_work > SETTINGS.max_trade_work:
        raise HTTPException(413, f"Trade-study workload {total_work:,} exceeds server limit {SETTINGS.max_trade_work:,}.")


def _tle_error(exc: Exception):
    if isinstance(exc, SGP4UnavailableError):
        raise HTTPException(503, str(exc)) from exc
    if isinstance(exc, TLEParseError):
        raise HTTPException(400, str(exc)) from exc
    raise exc


@app.get("/health")
def health():
    return {
        "status": "ok",
        "name": APP_NAME,
        "version": APP_VERSION,
        "mode": SETTINGS.mode,
        "render": os.getenv("RENDER", "false").lower() == "true",
        "sgp4_available": sgp4_available(),
    }


@app.get("/api/server-info")
def server_info():
    if not SETTINGS.expose_server_info:
        raise HTTPException(404, "Server information is disabled.")
    return {
        "version": APP_VERSION,
        "mode": SETTINGS.mode,
        "render": os.getenv("RENDER", "false").lower() == "true",
        "render_service": os.getenv("RENDER_SERVICE_NAME"),
        "render_external_url": os.getenv("RENDER_EXTERNAL_URL"),
        "git_branch": os.getenv("RENDER_GIT_BRANCH"),
        "git_commit": os.getenv("RENDER_GIT_COMMIT"),
        "limits": {
            "max_satellites": SETTINGS.max_satellites,
            "max_tle_satellites": SETTINGS.max_tle_satellites,
            "max_stations": SETTINGS.max_stations,
            "max_coverage_areas": SETTINGS.max_coverage_areas,
            "max_heatmap_points": SETTINGS.max_heatmap_points,
            "max_sim_samples": SETTINGS.max_sim_samples,
            "max_trade_cases": SETTINGS.max_trade_cases,
        },
    }


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots_txt():
    return "User-agent: *\nDisallow: /\n"


@app.get("/api/visualization/config")
def visualization_config():
    return {
        "cesium_version": "1.144",
        "cesium_cdn_js": "https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/Cesium.js",
        "cesium_cdn_css": "https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/Widgets/widgets.css",
        "offline_imagery_url": "/static/earth_blue_marble_2048.jpg",
        "satellite_model_url": "/static/kleo_satellite.glb",
        "online_imagery": "ArcGIS World Imagery",
        "online_imagery_url": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        "local_cesium_available": (BASE / "static" / "vendor" / "cesium" / "Cesium.js").exists(),
        "natural_earth_local_url": "/static/ne_50m_admin_0_countries.geojson",
        "natural_earth_remote_url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
        "boundary_fallback_url": "/static/service_boundaries_fallback.geojson",
        "natural_earth_local_available": (BASE / "static" / "ne_50m_admin_0_countries.geojson").exists(),
    }


@app.get("/api/service-regions/catalog")
def service_region_catalog():
    payload = catalog_payload()
    payload.update({
        "boundary_local_url": "/static/ne_50m_admin_0_countries.geojson",
        "boundary_remote_url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
        "boundary_fallback_url": "/static/service_boundaries_fallback.geojson",
        "boundary_local_available": (BASE / "static" / "ne_50m_admin_0_countries.geojson").exists(),
    })
    return payload


@app.post("/api/service-regions/resolve")
def resolve_service_regions(req: ServiceSelectionIn):
    result = resolve_selection(req.country_codes, req.region_codes, req.cities_per_country)
    for station in result["stations"]:
        station["min_elevation_deg"] = req.min_elevation_deg
    return result


@app.get("/api/preset/k-leo")
def preset():
    return {
        "altitude_km": 1280.0,
        "inclination_deg": 42.0,
        "planes": 8,
        "sats_per_plane": 16,
        "phasing": 1,
        "j2": True,
        "stations": [
            {"name": "Seoul", "lat_deg": 37.5665, "lon_deg": 126.9780, "min_elevation_deg": 20},
            {"name": "Dubai", "lat_deg": 25.2048, "lon_deg": 55.2708, "min_elevation_deg": 20},
            {"name": "Singapore", "lat_deg": 1.3521, "lon_deg": 103.8198, "min_elevation_deg": 20},
        ],
    }


@app.post("/api/simulate")
def simulate(req: SimIn):
    satellite_count = _enforce_walker_limits(req)
    _enforce_sim_limits(req, satellite_count)
    c = constellation_from(req)
    sim = SimulationConfig(c, station_objs(req.stations), req.duration_min, req.step_sec, LinkBudgetConfig())
    return run_simulation(sim)


@app.post("/api/tle/simulate")
def simulate_tle(req: TLESimIn):
    _enforce_station_count(req.stations)
    records = _parse_tles_guarded(req.tle_text)
    _enforce_sim_limits(req, len(records))
    try:
        return tle_station_timelines(req.tle_text, req.start_utc, station_objs(req.stations), req.duration_min, req.step_sec)
    except (SGP4UnavailableError, TLEParseError) as exc:
        _tle_error(exc)


@app.post("/api/tle/parse")
def parse_tle(req: TLEParseIn):
    records = _parse_tles_guarded(req.tle_text)
    return {
        "count": len(records),
        "sgp4_available": sgp4_available(),
        "satellites": [
            {
                "name": r.name,
                "norad_id": r.norad_id,
                "epoch_utc": r.epoch_utc.isoformat().replace("+00:00", "Z"),
                "inclination_deg": r.inclination_deg,
                "raan_deg": r.raan_deg,
                "eccentricity": r.eccentricity,
                "mean_motion_rev_day": r.mean_motion_rev_day,
                "period_min": r.orbital_period_min,
            }
            for r in records
        ],
    }


@app.post("/api/snapshot")
def snapshot(req: SnapshotIn):
    _enforce_station_count(req.stations)
    if len(req.coverage_areas) > SETTINGS.max_coverage_areas:
        raise HTTPException(413, f"Too many coverage areas: {len(req.coverage_areas)} > {SETTINGS.max_coverage_areas}.")
    if req.heatmap_points > SETTINGS.max_heatmap_points:
        raise HTTPException(413, f"Heat-map resolution {req.heatmap_points} exceeds server limit {SETTINGS.max_heatmap_points}.")
    try:
        if req.mode == "tle":
            if not req.tle_text:
                raise HTTPException(400, "TLE mode requires tle_text.")
            records = _parse_tles_guarded(req.tle_text)
            if req.heatmap:
                area_count = max(1, len(req.coverage_areas))
                work = len(records) * req.heatmap_points * req.heatmap_points * area_count
                if work > SETTINGS.max_snapshot_work:
                    raise HTTPException(413, f"Snapshot workload {work:,} exceeds server limit {SETTINGS.max_snapshot_work:,}.")
            return tle_snapshot(
                req.tle_text,
                req.start_utc,
                req.time_sec,
                min_elevation_deg=req.min_elevation_deg,
                heatmap=req.heatmap,
                heatmap_points=req.heatmap_points,
                stations=station_objs(req.stations),
                include_orbits=req.include_orbits,
                include_isl=req.include_isl,
                include_access=req.include_access,
                orbit_samples=req.orbit_samples,
                coverage_areas=[x.model_dump() for x in req.coverage_areas],
            )
        _enforce_walker_limits(req, snapshot=True)
        c = constellation_from(req)
        return walker_snapshot(
            c,
            req.time_sec,
            min_elevation_deg=req.min_elevation_deg,
            heatmap=req.heatmap,
            heatmap_points=req.heatmap_points,
            stations=station_objs(req.stations),
            include_orbits=req.include_orbits,
            include_isl=req.include_isl,
            include_access=req.include_access,
            orbit_samples=req.orbit_samples,
            coverage_areas=[x.model_dump() for x in req.coverage_areas],
        )
    except (SGP4UnavailableError, TLEParseError) as exc:
        _tle_error(exc)


@app.post("/api/trade-study")
def trade(req: TradeIn):
    _enforce_trade_limits(req)
    return {
        "results": trade_study(
            req.altitudes_km,
            req.inclinations_deg,
            req.planes_list,
            req.sats_per_plane_list,
            station_objs(req.stations),
            req.phasing,
            req.duration_min,
            req.step_sec,
            req.min_availability,
        )
    }


@app.get("/", response_class=HTMLResponse)
def root():
    return FileResponse(BASE / "static" / "index.html")
