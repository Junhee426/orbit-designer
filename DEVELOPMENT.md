# Development — Test Orbit Designer V1.0.0

## Local uv development

```bash
uv python install 3.12
uv sync
uv run kleo --reload
```

Local browser URL:

```text
http://127.0.0.1:8000
```

## Production-like local server

```bash
PORT=10000 KLEO_SERVER_MODE=production uv run kleo-server
```

Unlike `kleo`, `kleo-server` never opens a browser and always binds to `0.0.0.0` using `$PORT`.

## Tests

```bash
uv run pytest -ra
uv run kleo-validate
```

## Docker

```bash
docker compose up --build
```

Open `http://127.0.0.1:10000`.

## Server-limit configuration

See `.env.example` and `render.yaml`. Limits are read once at application startup by `app/server_config.py`.

## Render

See `RENDER_DEPLOYMENT.md` for the GitHub → Render Blueprint workflow.
