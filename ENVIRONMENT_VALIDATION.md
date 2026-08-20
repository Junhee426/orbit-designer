# Environment Validation — V1.5 Render Server Edition

## Result

- Python compileall: **PASS**
- Browser JavaScript `node --check`: **PASS**
- `render.yaml` YAML parse and deployment-contract checks: **PASS**
- Pytest: **51 passed / 1 skipped**
- Python wheel build: **PASS**
- Production Uvicorn HTTP smoke using `$PORT=18081`: **PASS**
- Docker image build: **NOT RUN** because the sandbox does not provide a Docker engine

## Production HTTP smoke

The production entrypoint `python -m app.server` was started with:

```text
PORT=18081
KLEO_SERVER_MODE=production
WEB_CONCURRENCY=1
```

Verified:

```text
GET  /health                         200
GET  /                              200
GET  /static/kleo_satellite.glb     200
GET  /api/server-info               200
POST /api/snapshot                  200
```

K-LEO snapshot response:

```text
satellites   256
orbit paths   16
ISL links    512
```

Cache behavior:

```text
API/root: no-store
/static/*: public, max-age=86400
```

## Conditional skip

The historical SGP4 reference-vector test is skipped only because the current sandbox cannot download/install the external `sgp4` runtime. `sgp4` remains a normal project dependency and is installed during a connected Render/Docker build.
