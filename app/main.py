from pathlib import Path
import math
import os
import time
from typing import List, Literal, Optional
import uuid
import hashlib
import json
import threading
from functools import wraps
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, model_validator

from .core.models import ConstellationConfig, GroundStation, LinkBudgetConfig, SimulationConfig
from .core.geometry import walker_orbital_geometry
from .core.multishell import multi_shell_snapshot, run_multi_shell_simulation, multi_shell_orbital_geometry, normalize_shell_id
from .core.optimizer import trade_study
from .core.simulation import run_simulation
from .core.snapshot import tle_snapshot, tle_station_timelines, walker_snapshot
from .core.service_regions import catalog_payload, resolve_selection
from .core.tle import SGP4UnavailableError, TLEParseError, parse_tle_text, sgp4_available
from .server_config import SETTINGS
from .core.sampling import sample_count
from . import __version__

BASE = Path(__file__).resolve().parent
APP_NAME = "Test Orbit Designer"
APP_VERSION = __version__
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Render-ready LEO satellite communications constellation design service.",
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # JSON permits some parsers to read NaN; never echo non-finite values into JSONResponse.
    safe = json.loads(json.dumps(exc.errors(), default=str), parse_constant=lambda value: value)
    return JSONResponse(status_code=422, content={"detail": safe})


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


_COMPUTE_SLOTS = threading.BoundedSemaphore(SETTINGS.max_concurrent_jobs)


def bounded_compute(func):
    @wraps(func)
    def wrapped(req):
        if not _COMPUTE_SLOTS.acquire(blocking=False):
            raise HTTPException(503, "Server is busy. Please retry after the current analysis finishes.", headers={"Retry-After": "1"})
        try:
            result = func(req)
            if isinstance(result, dict) and ("coverage_summary" in result or "results" in result):
                inputs = req.model_dump(mode="json")
                canonical = json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                result["analysis_metadata"] = {
                    "app_version": APP_VERSION,
                    "generated_utc": datetime.now(timezone.utc).isoformat(),
                    "input_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
                    "inputs": inputs,
                    "availability_basis": "geometric_visibility",
                    "sampling_method": "left_hold_intervals",
                    "sampling_note": "Each sampled state applies until the next sample; the exact end time is included. Shorter outages than the time step may be missed.",
                    "limitations": ["Spherical Earth", "Walker circular two-body plus optional J2 RAAN drift", "No RF/weather/gateway/capacity/failure availability model", "Station-point visibility is not whole-country coverage"],
                }
            return result
        finally:
            _COMPUTE_SLOTS.release()
    return wrapped


class InputModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, validate_default=True)


Altitude = Annotated[float, Field(ge=160, le=3000)]
Inclination = Annotated[float, Field(ge=0, le=180)]
Planes = Annotated[int, Field(ge=1, le=128)]
Slots = Annotated[int, Field(ge=1, le=256)]


class StationIn(InputModel):
    name: str = Field(min_length=1, max_length=120)
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    min_elevation_deg: float = Field(20.0, ge=0, le=90)


class CoverageAreaIn(InputModel):
    code: str = "CUSTOM"
    name: str = "Service area"
    lon_min: float = Field(ge=-180, le=180)
    lat_min: float = Field(ge=-90, le=90)
    lon_max: float = Field(ge=-180, le=180)
    lat_max: float = Field(ge=-90, le=90)


    @model_validator(mode="after")
    def check_bounds(self):
        if self.lat_max <= self.lat_min or self.lon_max <= self.lon_min:
            raise ValueError("Coverage maximum bounds must exceed minimum bounds; split dateline-crossing areas.")
        return self


class ServiceSelectionIn(InputModel):
    country_codes: List[str] = []
    region_codes: List[str] = []
    cities_per_country: int = Field(3, ge=1, le=5)
    min_elevation_deg: float = Field(20.0, ge=0.0, le=90.0)


class SimIn(InputModel):
    include_routes: bool = False
    altitude_km: Altitude = 1280.0
    inclination_deg: Inclination = 42.0
    planes: Planes = 8
    sats_per_plane: Slots = 16
    phasing: int = Field(1, ge=0, le=127)
    j2: bool = True
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(60.0, ge=1, le=3600)
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]




class ShellIn(InputModel):
    id: str = "SH1"
    name: str = "Shell 1"
    altitude_km: Altitude = 1280.0
    inclination_deg: Inclination = 42.0
    planes: Planes = 8
    sats_per_plane: Slots = 16
    phasing: int = Field(1, ge=0, le=127)
    j2: bool = True


class MultiShellSimIn(InputModel):
    shells: List[ShellIn] = [
        ShellIn(id="SH1", name="Core 1280 km", altitude_km=1280, inclination_deg=42, planes=8, sats_per_plane=16, phasing=1),
        ShellIn(id="SH2", name="High-inclination supplement", altitude_km=600, inclination_deg=70, planes=6, sats_per_plane=12, phasing=1),
    ]
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(60.0, ge=1, le=3600)
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]


class TLESimIn(InputModel):
    tle_text: str = Field(min_length=1, max_length=SETTINGS.max_tle_chars)
    start_utc: Optional[str] = None
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(60.0, ge=1, le=3600)
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
    ]


class SnapshotIn(InputModel):
    mode: Literal["walker", "multi_shell", "tle"] = "walker"
    time_sec: float = Field(0.0, ge=0.0, le=604800.0)
    min_elevation_deg: float = Field(20.0, ge=0.0, le=90.0)
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
    altitude_km: Altitude = 1280.0
    inclination_deg: Inclination = 42.0
    planes: Planes = 8
    sats_per_plane: Slots = 16
    phasing: int = Field(1, ge=0, le=127)
    j2: bool = True

    # Multi-shell Walker fields
    shells: List[ShellIn] = []

    # TLE fields
    tle_text: Optional[str] = Field(None, max_length=SETTINGS.max_tle_chars)
    start_utc: Optional[str] = None


class OrbitalGeometryIn(InputModel):
    mode: Literal["walker", "multi_shell"] = "walker"
    satellite_id: str = Field(min_length=1, max_length=80)
    time_sec: float = Field(0.0, ge=0.0, le=604800.0)
    min_elevation_deg: float = Field(20.0, ge=0.0, le=90.0)
    ground_track_span_min: float = Field(220.0, ge=10.0, le=1440.0)
    ground_track_samples: int = Field(181, ge=24, le=720)
    footprint_samples: int = Field(72, ge=24, le=360)
    altitude_km: Altitude = 1280.0
    inclination_deg: Inclination = 42.0
    planes: Planes = 8
    sats_per_plane: Slots = 16
    phasing: int = Field(1, ge=0, le=127)
    j2: bool = True
    shells: List[ShellIn] = []


class TLEParseIn(InputModel):
    tle_text: str = Field(min_length=1, max_length=SETTINGS.max_tle_chars)


class TradeIn(InputModel):
    altitudes_km: List[Altitude] = Field(default=[500, 888, 1280], min_length=1, max_length=64)
    inclinations_deg: List[Inclination] = Field(default=[42], min_length=1, max_length=64)
    planes_list: List[Planes] = Field(default=[8, 16], min_length=1, max_length=64)
    sats_per_plane_list: List[Slots] = Field(default=[16], min_length=1, max_length=64)
    phasing: int = Field(1, ge=0, le=127)
    duration_min: float = Field(120.0, gt=0, le=1440)
    step_sec: float = Field(180.0, ge=1, le=3600)
    min_availability: float = Field(0.95, ge=0, le=1)
    j2: bool = True
    stations: List[StationIn] = [
        StationIn(name="Seoul", lat_deg=37.5665, lon_deg=126.9780, min_elevation_deg=20),
        StationIn(name="Dubai", lat_deg=25.2048, lon_deg=55.2708, min_elevation_deg=20),
        StationIn(name="Singapore", lat_deg=1.3521, lon_deg=103.8198, min_elevation_deg=20),
    ]


def shell_cfgs(items: List[ShellIn]):
    if not items:
        raise HTTPException(400, "Multi-shell mode requires at least one shell.")
    result = []
    total = 0
    seen_ids = set()
    for i, x in enumerate(items):
        shell_id = normalize_shell_id(x.id, i)
        if shell_id in seen_ids:
            raise HTTPException(400, f"Duplicate shell id: {shell_id}.")
        seen_ids.add(shell_id)
        cfg = ConstellationConfig(x.altitude_km, x.inclination_deg, x.planes, x.sats_per_plane, x.phasing, x.j2)
        total += cfg.total_satellites
        result.append((shell_id, x.name or f"Shell {i+1}", cfg))
    if total > SETTINGS.max_satellites:
        raise HTTPException(413, f"Multi-shell constellation has {total} satellites; server limit is {SETTINGS.max_satellites}.")
    return result


def _enforce_snapshot_workload(req, count: int) -> None:
    areas = list(getattr(req, "coverage_areas", []) or [])
    if len(areas) > SETTINGS.max_coverage_areas:
        raise HTTPException(413, f"Too many coverage areas: {len(areas)} > {SETTINGS.max_coverage_areas}.")
    hp = int(getattr(req, "heatmap_points", 0) or 0)
    if hp > SETTINGS.max_heatmap_points:
        raise HTTPException(413, f"Heat-map resolution {hp} exceeds server limit {SETTINGS.max_heatmap_points}.")
    if bool(getattr(req, "heatmap", False)):
        work = count * hp * hp * max(1, len(areas))
        if work > SETTINGS.max_snapshot_work:
            raise HTTPException(413, f"Snapshot workload {work:,} exceeds server limit {SETTINGS.max_snapshot_work:,}.")


def _enforce_multi_shell_limits(req, *, snapshot: bool = False) -> int:
    shells = shell_cfgs(req.shells)
    count = sum(x[2].total_satellites for x in shells)
    _enforce_station_count(list(getattr(req, "stations", []) or []))
    if snapshot:
        _enforce_snapshot_workload(req, count)
    return count


def station_objs(items):
    return [GroundStation(x.name, x.lat_deg, x.lon_deg, x.min_elevation_deg) for x in items]


def constellation_from(req) -> ConstellationConfig:
    return ConstellationConfig(
        req.altitude_km,
        req.inclination_deg,
        req.planes,
        req.sats_per_plane,
        req.phasing,
        req.j2,
    )


def _enforce_station_count(stations: List[StationIn]) -> None:
    if len(stations) > SETTINGS.max_stations:
        raise HTTPException(413, f"Too many stations: {len(stations)} > {SETTINGS.max_stations}.")


def _enforce_walker_limits(req, *, snapshot: bool = False) -> int:
    count = int(req.planes) * int(req.sats_per_plane)
    if count > SETTINGS.max_satellites:
        raise HTTPException(413, f"Constellation has {count} satellites; server limit is {SETTINGS.max_satellites}.")
    _enforce_station_count(list(getattr(req, "stations", []) or []))
    if snapshot:
        _enforce_snapshot_workload(req, count)
    return count


def _enforce_sim_limits(req, satellite_count: int) -> None:
    samples = sample_count(float(req.duration_min), float(req.step_sec))
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
    samples = sample_count(float(req.duration_min), float(req.step_sec))
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
        "capabilities": {
            "walker": True,
            "multi_shell_walker": True,
            "ground_track": True,
            "minimum_elevation_footprint": True,
            "tle_sgp4": sgp4_available(),
            "multi_shell_cross_isl": False,
            "scenario_io": True,
            "candidate_comparison": True,
        },
        "limits": {
            "max_concurrent_jobs": SETTINGS.max_concurrent_jobs,
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
    result["limits"] = {"max_stations": SETTINGS.max_stations, "max_coverage_areas": SETTINGS.max_coverage_areas}
    if len(result["stations"]) > SETTINGS.max_stations:
        raise HTTPException(413, f"Selected {len(result['stations'])} cities; limit is {SETTINGS.max_stations}. Reduce cities per country or select fewer countries.")
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
        "multi_shells": [
            {"id": "SH1", "name": "Core 1280 km", "altitude_km": 1280.0, "inclination_deg": 42.0, "planes": 8, "sats_per_plane": 16, "phasing": 1, "j2": True},
            {"id": "SH2", "name": "High-inclination supplement", "altitude_km": 600.0, "inclination_deg": 70.0, "planes": 6, "sats_per_plane": 12, "phasing": 1, "j2": True},
        ],
        "stations": [
            {"name": "Seoul", "lat_deg": 37.5665, "lon_deg": 126.9780, "min_elevation_deg": 20},
            {"name": "Dubai", "lat_deg": 25.2048, "lon_deg": 55.2708, "min_elevation_deg": 20},
            {"name": "Singapore", "lat_deg": 1.3521, "lon_deg": 103.8198, "min_elevation_deg": 20},
        ],
    }


@app.post("/api/simulate")
@bounded_compute
def simulate(req: SimIn):
    satellite_count = _enforce_walker_limits(req)
    _enforce_sim_limits(req, satellite_count)
    c = constellation_from(req)
    sim = SimulationConfig(c, station_objs(req.stations), req.duration_min, req.step_sec, LinkBudgetConfig(), req.include_routes)
    return run_simulation(sim)


@app.post("/api/multi-shell/simulate")
@bounded_compute
def simulate_multi_shell(req: MultiShellSimIn):
    count = _enforce_multi_shell_limits(req)
    _enforce_sim_limits(req, count)
    return run_multi_shell_simulation(shell_cfgs(req.shells), station_objs(req.stations), req.duration_min, req.step_sec)


@app.post("/api/tle/simulate")
@bounded_compute
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
@bounded_compute
def snapshot(req: SnapshotIn):
    _enforce_station_count(req.stations)
    try:
        if req.mode == "tle":
            if not req.tle_text:
                raise HTTPException(400, "TLE mode requires tle_text.")
            records = _parse_tles_guarded(req.tle_text)
            _enforce_snapshot_workload(req, len(records))
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
        if req.mode == "multi_shell":
            _enforce_multi_shell_limits(req, snapshot=True)
            return multi_shell_snapshot(
                shell_cfgs(req.shells), req.time_sec,
                min_elevation_deg=req.min_elevation_deg, heatmap=req.heatmap, heatmap_points=req.heatmap_points,
                stations=station_objs(req.stations), include_orbits=req.include_orbits, include_isl=req.include_isl,
                include_access=req.include_access, orbit_samples=req.orbit_samples,
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


@app.post("/api/orbital-geometry")
@bounded_compute
def orbital_geometry(req: OrbitalGeometryIn):
    try:
        common = dict(
            min_elevation_deg=req.min_elevation_deg,
            ground_track_span_min=req.ground_track_span_min,
            ground_track_samples=req.ground_track_samples,
            footprint_samples=req.footprint_samples,
        )
        if req.mode == "multi_shell":
            return multi_shell_orbital_geometry(shell_cfgs(req.shells), req.satellite_id, req.time_sec, **common)
        _enforce_walker_limits(req)
        return walker_orbital_geometry(constellation_from(req), req.satellite_id, req.time_sec, **common)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/trade-study")
@bounded_compute
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
            j2=req.j2,
        )
    }


@app.get("/", response_class=HTMLResponse)
def root():
    return FileResponse(BASE / "static" / "index.html")


class ScenarioIn(InputModel):
    schema_version: Literal["kleo.scenario.v1"] = "kleo.scenario.v1"
    name: str = Field("K-LEO scenario", min_length=1, max_length=120)
    configuration: SnapshotIn
    selection: ServiceSelectionIn
    duration_min: float = Field(120, gt=0, le=1440)
    step_sec: float = Field(60, ge=1, le=3600)


@app.post("/api/scenario/validate")
def validate_scenario(req: ScenarioIn):
    cfg = req.configuration
    if cfg.mode == "walker":
        count = _enforce_walker_limits(cfg, snapshot=True)
    elif cfg.mode == "multi_shell":
        count = _enforce_multi_shell_limits(cfg, snapshot=True)
    else:
        count = len(_parse_tles_guarded(cfg.tle_text or ""))
        from .core.snapshot import parse_utc
        try:
            parse_utc(cfg.start_utc)
        except TLEParseError as exc:
            raise HTTPException(400, str(exc)) from exc
    _enforce_sim_limits(SimIn(duration_min=req.duration_min, step_sec=req.step_sec, stations=cfg.stations), count)
    selected = resolve_service_regions(req.selection)
    # The UI restores country selection. Ensure its regenerated cities fit the workload too.
    _enforce_sim_limits(SimIn(duration_min=req.duration_min, step_sec=req.step_sec, stations=selected["stations"]), count)
    req.selection.country_codes = selected["country_codes"]
    req.selection.region_codes = []
    req.configuration.stations = [StationIn(**row) for row in selected["stations"]]
    req.configuration.coverage_areas = [CoverageAreaIn(**row) for row in selected["coverage_areas"]]
    req.configuration.min_elevation_deg = req.selection.min_elevation_deg
    return req.model_dump(mode="json")
