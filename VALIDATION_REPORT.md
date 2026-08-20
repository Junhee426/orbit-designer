# K-LEO Orbit Designer V1.5 — Validation Report

## Scope

V1.5 validates that the V1.4.2 constellation/coverage/Cesium application can operate as a Render-hosted, multi-user stateless web service.

## Regression tests

```text
51 passed
1 skipped
```

The skipped test is the conditional SGP4 historical reference-vector test because the isolated sandbox does not contain the external `sgp4` package. All Walker, geometry, coverage, heatmap, ISL, routing, service-region, Cesium UI, asset, occlusion, API, server-limit, and Render deployment-contract tests pass.

## Render production-entrypoint test

`app.server` was started with a non-default `PORT=18081` to prove that the service does not depend on local port 8000/10000.

HTTP verification:

```text
/health                         200
/                               200
/static/kleo_satellite.glb      200
/api/server-info                200
/api/snapshot                   200
```

The default K-LEO Walker snapshot returned:

```text
256 satellites
16 orbit paths
512 ISL links
```

## Public workload guards

Server-mode validation rejects requests above configured limits with HTTP 413. The default Render Blueprint limits are intentionally well above the K-LEO 256-satellite scenario while preventing accidental public requests containing tens of thousands of satellites or extremely large heat-map workloads.

## Packaging

Wheel build passed and contains:

- `app/server.py`
- `app/server_config.py`
- FastAPI application
- Cesium frontend
- Blue Marble texture
- all four GLB satellite models
- Plotly bundle
- fallback service-boundary GeoJSON
- `kleo-server` console entrypoint

Built artifact:

```text
dist/k_leo_orbit_designer-1.5.0-py3-none-any.whl
```

## Docker limitation of this validation environment

The provided sandbox has no Docker daemon/client. Therefore `docker build` itself could not be executed here. The Dockerfile is covered by static deployment-contract tests, the Python wheel it installs was built successfully, and the exact `kleo-server` production process invoked by the container was exercised through real HTTP requests.
