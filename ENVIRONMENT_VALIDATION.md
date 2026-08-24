# Environment Validation — Test Orbit Designer V1.1.0

Validation environment uses the available Python 3.12-compatible runtime in the execution sandbox.

Validated:

- Python source compilation
- FastAPI TestClient endpoints
- Cesium frontend JavaScript syntax (`node --check`)
- 62 automated tests
- Python wheel build
- production-style HTTP server smoke test

Conditional skip:

- One Vallado SGP4 reference-vector test is skipped when the external `sgp4` runtime is unavailable in the sandbox. `sgp4` remains declared in `pyproject.toml` and is installed by a normal `uv sync` / Docker build with package access.

Docker Engine is not required for the source-level validation. The same `app.server` production entrypoint used by the Docker container is tested directly.
