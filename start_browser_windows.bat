@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.x is required to serve local files.
  pause
  exit /b 1
)
if not exist "standalone\vendor\cesium\Cesium.js" (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 exit /b 1
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)
echo Open http://127.0.0.1:8080 in your browser.
echo All calculations run in the browser. This process only serves files.
node scripts\serve-standalone.mjs
