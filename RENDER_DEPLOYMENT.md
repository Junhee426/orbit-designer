# Render Deployment Guide — Test Orbit Designer V1.1.0

## 1. GitHub repository root

Confirm these files are at repository root:

```text
Dockerfile
render.yaml
pyproject.toml
app/
```

## 2. Render

1. Render Dashboard -> **New -> Blueprint**
2. Connect the GitHub repository.
3. Select the branch containing V1.1.0.
4. Apply the Blueprint.

`render.yaml` uses:

```text
runtime: docker
plan: free
region: singapore
healthCheckPath: /health
autoDeployTrigger: commit
```

V1.1.0 intentionally omits `maxShutdownDelaySeconds`, because that field is not supported by Render Free-tier services.

## 3. Verify

After deployment:

```text
https://<service>.onrender.com/health
https://<service>.onrender.com/api/server-info
https://<service>.onrender.com/docs
https://<service>.onrender.com/
```

Expected health version:

```json
{"status":"ok","name":"Test Orbit Designer","version":"1.1.0"}
```

## 4. New V1.1 endpoints

```text
POST /api/multi-shell/simulate
POST /api/orbital-geometry
POST /api/snapshot  (mode=multi_shell supported)
```

## 5. Free tier notes

Render Free services may spin down after inactivity. This does not affect application correctness but the first request after idle can take longer.

For permanent internal operation, a paid Render plan or an internal Docker host is recommended.
