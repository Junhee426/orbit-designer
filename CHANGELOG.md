# Changelog

## 1.2.0 — Reliable visibility analysis and candidate comparison

- Fix sampled outage durations, time-weighted metrics and reconnection counting.
- Share each propagated state across stations; chunk Heat Map working arrays.
- Validate finite/ranged inputs and cap concurrent compute requests.
- Apply direct-LOS horizon consistently and support 64 service points.
- Serialize playback requests, ignore stale responses and invalidate stale metrics.
- Add six-candidate comparison, scenario JSON save/load and JSON/CSV result exports.
- Record calculation conditions and explicitly label geometric visibility.
- Use the dependency lock in Docker and correct remaining Vanguard reference fixtures.

## 1.1.0 — Orbital Analysis

- Added selected-satellite Ground Track rendering with dateline-safe segmentation.
- Added minimum-elevation spherical visibility footprint calculation and Cesium overlay.
- Added Multi-shell Walker mode with dynamic shell add/remove UI.
- Added combined multi-shell coverage, access, heat-map, and service timeline analysis.
- Added `/api/orbital-geometry` and `/api/multi-shell/simulate`.
- Added multi-shell support to `/api/snapshot`.
- Added Ground Track / Footprint Cesium layer controls.
- Preserved global initial camera and disabled service-area auto zoom.
- Removed `maxShutdownDelaySeconds` from `render.yaml` for Render Free-tier compatibility.
- Updated product/package version to Test Orbit Designer V1.1.0.
- Added geometry/multi-shell/API/UI regression tests.

### Current V1.1 limitation

Multi-shell ISL is computed within each shell. Cross-shell ISL and inter-shell routing are not yet implemented.

## 1.0.0 — Test Orbit Designer

- Unified product identity as Test Orbit Designer V1.0.0.
- Default Walker configuration: 1280 km / 42 deg / 8 planes / 16 satellites per plane.
- Render-ready FastAPI + CesiumJS deployment.
