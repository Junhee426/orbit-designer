# Changelog

## 1.5.0 — Render Server Edition

- Added `Dockerfile` for Render-compatible container deployment.
- Added `render.yaml` Blueprint: Docker web service, Singapore region, `/health`, commit auto-deploy.
- Added `kleo-server` production entrypoint using `0.0.0.0` and Render's `$PORT`.
- Added Render-aware server metadata endpoint (`/api/server-info`).
- Added production response headers, request IDs, gzip, static-asset cache policy, and `robots.txt`.
- Added configurable public-server workload guards for constellation size, TLE count, coverage resolution, simulation samples, and trade-study size.
- Kept all scenario computations stateless so multiple browser users do not share constellation state.
- Added Docker Compose and `.env.example` for production-like local testing.
- Added Render deployment documentation and deployment contract tests.
- Updated UI/version metadata to V1.5.0 Server Edition.

## 1.4.2

- Removed point-marker outlines.
- Added selectable satellite GLB styles.
