# Test Orbit Designer V1.0.0 — Validation Report

## Scope

This validation covers the renamed application, the new default Walker configuration, the global initial camera behavior, and the existing Render server/Cesium functionality.

## Default scenario

```text
Altitude             1280 km
Inclination          42 deg
Planes               8
Satellites / plane   16
Total satellites     128
Walker phasing F     1
```

## Regression tests

```text
53 passed
1 skipped
```

The skipped test is the conditional SGP4 reference-vector test because the isolated validation runtime does not contain the external `sgp4` package.

## Identity consistency

The user-facing and API identity is unified as **Test Orbit Designer V1.0.0** in the HTML title/header, FastAPI metadata, `/health`, CLI version output, and Python package version.

## Initial camera behavior

The initial Cesium camera remains at the global view (`100 E, 20 N, 30,000 km`). Applying or clearing a service area does not automatically zoom the camera. The `Service area` button remains available for manual zoom.

## Packaging

The wheel build passes with build isolation disabled in this network-restricted validation environment:

```text
dist/k_leo_orbit_designer-1.0.0-py3-none-any.whl
```
