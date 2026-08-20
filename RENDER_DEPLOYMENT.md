# Render Deployment Guide — K-LEO Orbit Designer V1.5 Server Edition

## Recommended architecture

One Render Web Service serves both the FastAPI API and the CesiumJS frontend. No database is required. Simulation requests are stateless: each browser sends its current constellation/service-area settings with the request.

## 1. Push the project to GitHub

The repository root must contain:

- `Dockerfile`
- `render.yaml`
- `pyproject.toml`
- `app/`
- `scripts/`

Do not commit `.venv`, build outputs, or secrets.

## 2. Deploy with a Render Blueprint

1. Sign in to Render.
2. Choose **New → Blueprint**.
3. Connect the GitHub repository containing this project.
4. Render detects `render.yaml` in the repository root.
5. Apply the Blueprint.
6. Wait for `/health` to report healthy.
7. Open the generated `https://<service>.onrender.com` URL.

The supplied Blueprint uses:

- Web Service
- Docker runtime
- Singapore region
- Free plan by default
- `/health` HTTP health check
- auto-deploy on commits

For continuous operational use, change `plan: free` to `starter` or a higher plan. The Free web-service plan spins down after inactivity and has an ephemeral filesystem.

## 3. Render networking

`app.server` binds Uvicorn to:

- host: `0.0.0.0`
- port: `$PORT` (defaults to `10000`)

Do not hard-code a public hostname. Render terminates HTTPS at its edge and forwards traffic to the container.

## 4. Cesium / Earth assets

The deployed app always includes local fallback assets:

- NASA Blue Marble texture
- 4 satellite GLB models
- service-boundary fallback GeoJSON
- Plotly bundle used by analysis panels

CesiumJS itself uses the configured local vendor copy when present and otherwise loads the official Cesium CDN. Online Earth uses ArcGIS World Imagery, with automatic fallback to the included Blue Marble image.

For a public Render deployment this keeps the Docker image small. If a fully self-contained image is required later, run `kleo-bootstrap-assets` before building and commit/vendor the resulting Cesium/Natural Earth assets.

## 5. Public-server workload limits

The Server Edition rejects requests above configurable limits. Defaults are in `render.yaml` and `.env.example`.

Important variables:

- `KLEO_MAX_SATELLITES=4096`
- `KLEO_MAX_TLE_SATELLITES=512`
- `KLEO_MAX_HEATMAP_POINTS=60`
- `KLEO_MAX_COVERAGE_AREAS=18`
- `KLEO_MAX_SIM_SAMPLES=3000`
- `KLEO_MAX_TRADE_CASES=64`

K-LEO 888 km / 42° / 16×16 = 256 satellites is comfortably below these limits.

## 6. Health and diagnostics

- `GET /health` — lightweight readiness endpoint for Render
- `GET /api/server-info` — version, Render metadata, and configured public-workload limits
- `GET /docs` — FastAPI interactive API documentation

`/api/server-info` can be disabled by setting `KLEO_EXPOSE_SERVER_INFO=false`.

## 7. Local production-like test

Without Docker:

```bash
uv sync
PORT=10000 KLEO_SERVER_MODE=production uv run kleo-server
```

Open:

```text
http://127.0.0.1:10000
```

With Docker:

```bash
docker compose up --build
```

Then open the same URL.

## 8. Custom domain

After the service is healthy, add a custom domain from the Render service settings. Render provides managed TLS for supported custom domains.

## 9. Persistence

This version intentionally stores no user scenario state on the server. Render's local filesystem is ephemeral, so persistent scenarios should later be stored in a database/object store rather than written to local files.
