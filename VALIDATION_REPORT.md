# Test Orbit Designer V1.1.0 — Validation Report

## Result

**PASS** for source/API/UI regression validation and production-entrypoint smoke testing.

## Automated tests

```text
62 tests collected
61 passed
1 skipped (conditional SGP4 reference-vector test)
```

The skipped test requires the external `sgp4` runtime. The package remains declared in `pyproject.toml`; normal `uv sync` / Render Docker builds install it when package access is available.

## Static checks

| Check | Result |
|---|---|
| Python `compileall` | PASS |
| Cesium frontend JavaScript `node --check` | PASS |
| FastAPI API regression | PASS |
| Render Blueprint contract | PASS |
| Wheel build | PASS |
| Production `app.server` HTTP smoke | PASS |

## V1.1 orbital geometry validation

Default Walker case:

```text
Altitude             1280 km
Inclination            42 deg
Planes                  8
Satellites / plane      16
Total satellites       128
Minimum elevation       20 deg
```

Selected `P01-S01` geometry:

```text
Footprint central angle     18.49798 deg
Footprint surface radius     2059.19 km
Ground-track samples              181
Ground-track dateline segments      3
```

The footprint uses the spherical visibility relation

```text
psi = acos((R_E / (R_E + h)) cos(E)) - E
```

with negative minimum elevation clamped to the geometric horizon (`E = 0 deg`) for direct LOS footprint calculations.

## V1.1 Multi-shell validation

Default V1.1 example:

```text
SH1: 1280 km / 42 deg / 8 x 16  = 128 satellites
SH2:  600 km / 70 deg / 6 x 12  =  72 satellites
Total                              200 satellites
Orbit paths                         14
```

Validated:

- combined satellite ECI/ECEF state
- shell-prefixed satellite IDs
- combined service visibility
- combined Coverage/Heat Map input geometry
- selected multi-shell Ground Track/Footprint
- intra-shell Walker ISL generation
- server total-satellite workload limits

V1.1 does **not** yet generate cross-shell ISL links.

## Production server smoke

Production-equivalent launch:

```text
PORT=18083
KLEO_SERVER_MODE=render
WEB_CONCURRENCY=1
python -m app.server
```

Verified HTTP responses:

```text
GET  /health                    200
GET  /api/server-info           200
POST /api/orbital-geometry      200
POST /api/snapshot multi_shell  200
```

`/api/server-info` advertises:

```text
multi_shell_walker           true
ground_track                 true
minimum_elevation_footprint  true
multi_shell_cross_isl        false
```

## Render Free-tier compatibility

`render.yaml` uses Docker, Singapore region, `/health`, and commit auto-deploy. The unsupported Free-tier field `maxShutdownDelaySeconds` is intentionally absent.

## Package

Built artifact:

```text
dist/k_leo_orbit_designer-1.1.0-py3-none-any.whl
```

Wheel content was checked for:

```text
app/core/geometry.py
app/core/multishell.py
app/static/index.html
app/server.py
```

## Environment limitation

Docker Engine is not installed in this validation sandbox, so `docker build` itself was not executed. The same production entrypoint invoked by the Docker image (`app.server` / `kleo-server`) was launched and tested over HTTP.
