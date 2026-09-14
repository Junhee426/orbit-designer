# Render deployment

The default deployment is now the browser-only Orbit Lab static site.

See [the Korean deployment guide](RENDER_STATIC_DEPLOYMENT_KO.md) for Blueprint and manual setup.

- Blueprint: `render.yaml` at repository root
- Build: `npm ci --ignore-scripts --include=dev --no-audit --no-fund && npm run build:render`
- Publish directory: `standalone`
- Root directory: repository root (leave blank in Render)
- Node: `.node-version`
- Environment: `SKIP_INSTALL_DEPS=true`
- No start command or health endpoint is needed for this static site.

The existing Python/Docker configuration is preserved in `render-docker.yaml`.
See [the legacy Docker guide](RENDER_DOCKER_DEPLOYMENT.md) for that separate service.
