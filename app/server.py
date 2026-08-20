from __future__ import annotations

import os

import uvicorn


def _int_env(name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def main() -> None:
    port = _int_env("PORT", 10000, minimum=1, maximum=65535)
    # Render publishes WEB_CONCURRENCY / RENDER_WEB_CONCURRENCY according to the instance CPU count.
    workers = _int_env(
        "WEB_CONCURRENCY",
        _int_env("RENDER_WEB_CONCURRENCY", 1, minimum=1, maximum=8),
        minimum=1,
        maximum=8,
    )
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        proxy_headers=True,
        forwarded_allow_ips="*",
        timeout_keep_alive=10,
        access_log=True,
    )


if __name__ == "__main__":
    main()
