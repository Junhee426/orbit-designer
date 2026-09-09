# syntax=docker/dockerfile:1
FROM python:3.12-slim AS builder
RUN python -m pip install --no-cache-dir uv==0.11.33
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY app ./app
COPY scripts ./scripts
RUN uv sync --locked --no-dev --no-editable

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=10000 KLEO_SERVER_MODE=render KLEO_STATIC_CACHE_SECONDS=86400 PATH="/app/.venv/bin:$PATH"
RUN addgroup --system kleo && adduser --system --ingroup kleo --home /home/kleo kleo
COPY --from=builder /app/.venv /app/.venv
USER kleo
WORKDIR /home/kleo
EXPOSE 10000
CMD ["kleo-server"]
