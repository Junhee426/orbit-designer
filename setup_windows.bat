@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
  echo [ERROR] uv is not installed or not on PATH.
  echo Install uv first, then run this file again.
  echo Official guide: https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)
echo [1/3] Installing/selecting Python 3.12...
uv python install 3.12
if errorlevel 1 goto :fail
echo [2/3] Synchronizing project environment...
uv sync
if errorlevel 1 goto :fail
echo [3/3] Running automated tests...
uv run pytest
if errorlevel 1 goto :fail
echo.
echo Environment setup complete.
echo Start with: uv run kleo
echo Optional full-offline Cesium + Natural Earth assets: uv run kleo-bootstrap-assets
pause
exit /b 0
:fail
echo.
echo Setup failed. Review the error above.
pause
exit /b 1
