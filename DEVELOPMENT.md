# Development — Test Orbit Designer V1.1.0

## Architecture

```text
CesiumJS browser UI
       |
       v
FastAPI
  |-- Walker analytical propagator
  |-- Multi-shell combiner
  |-- Ground Track / Footprint geometry
  |-- Coverage / Heat Map
  |-- ISL / Access / Routing
  `-- TLE / SGP4
```

## New V1.1 modules

- `app/core/geometry.py`
  - minimum-elevation footprint
  - footprint polygon
  - Walker selected-satellite ground track
  - selected Walker orbital geometry
- `app/core/multishell.py`
  - combined shell state
  - multi-shell snapshot
  - combined station visibility timeline
  - multi-shell service simulation
  - selected multi-shell satellite geometry

## Run

```bash
uv sync
uv run kleo --reload
```

## Tests

```bash
uv run pytest
```

## Design constraints

- The fast Walker engine remains analytical for large-constellation trade studies.
- Ground Track and Footprint are selected-satellite layers to reduce Cesium/server workload.
- Multi-shell V1.1 ISL is intra-shell only.
- API requests remain stateless for concurrent Render users.
