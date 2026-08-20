#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v uv >/dev/null 2>&1 || {
  echo "[ERROR] uv is not installed or not on PATH."
  echo "See: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
}
uv python install 3.12
uv sync
uv run pytest
echo "Environment setup complete. Start with: uv run kleo"
echo "Optional full-offline Cesium + Natural Earth assets: uv run kleo-bootstrap-assets"
