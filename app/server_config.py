from __future__ import annotations

from dataclasses import dataclass
import os


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise RuntimeError(f"{name} must be >= {minimum}, got {value}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ServerSettings:
    mode: str
    max_satellites: int
    max_tle_satellites: int
    max_stations: int
    max_coverage_areas: int
    max_heatmap_points: int
    max_sim_samples: int
    max_trade_cases: int
    max_snapshot_work: int
    max_sim_work: int
    max_trade_work: int
    max_tle_chars: int
    static_cache_seconds: int
    expose_server_info: bool

    @classmethod
    def from_env(cls) -> "ServerSettings":
        mode = os.getenv("KLEO_SERVER_MODE", "development").strip().lower() or "development"
        return cls(
            mode=mode,
            max_satellites=_env_int("KLEO_MAX_SATELLITES", 4096),
            max_tle_satellites=_env_int("KLEO_MAX_TLE_SATELLITES", 512),
            max_stations=_env_int("KLEO_MAX_STATIONS", 24),
            max_coverage_areas=_env_int("KLEO_MAX_COVERAGE_AREAS", 18),
            max_heatmap_points=_env_int("KLEO_MAX_HEATMAP_POINTS", 60),
            max_sim_samples=_env_int("KLEO_MAX_SIM_SAMPLES", 3000),
            max_trade_cases=_env_int("KLEO_MAX_TRADE_CASES", 64),
            max_snapshot_work=_env_int("KLEO_MAX_SNAPSHOT_WORK", 20_000_000),
            max_sim_work=_env_int("KLEO_MAX_SIM_WORK", 20_000_000),
            max_trade_work=_env_int("KLEO_MAX_TRADE_WORK", 30_000_000),
            max_tle_chars=_env_int("KLEO_MAX_TLE_CHARS", 200_000),
            static_cache_seconds=_env_int("KLEO_STATIC_CACHE_SECONDS", 86_400, minimum=0),
            expose_server_info=_env_bool("KLEO_EXPOSE_SERVER_INFO", True),
        )


SETTINGS = ServerSettings.from_env()
