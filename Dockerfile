# syntax=docker/dockerfile:1
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /src
COPY pyproject.toml README.md ./
COPY app ./app
COPY scripts ./scripts

RUN python -m pip install --upgrade pip \
    && python -m pip wheel --wheel-dir /wheels .

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000 \
    KLEO_SERVER_MODE=render \
    KLEO_STATIC_CACHE_SECONDS=86400

RUN addgroup --system kleo \
    && adduser --system --ingroup kleo --home /home/kleo kleo

COPY --from=builder /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/*.whl \
    && rm -rf /wheels

USER kleo
WORKDIR /home/kleo

EXPOSE 10000

CMD ["kleo-server"]
