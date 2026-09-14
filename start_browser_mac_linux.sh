#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -f standalone/vendor/cesium/Cesium.js ]; then
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
fi
exec node scripts/serve-standalone.mjs
