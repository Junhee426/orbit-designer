@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
  echo [ERROR] uv is not installed or not on PATH.
  pause
  exit /b 1
)
uv run kleo
