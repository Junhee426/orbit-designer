# Test Orbit Designer V1.2.0 — Validation Report

Baseline: Junhee426/kleo `7e4cf61c779db1e19b4512673bd56c02a13160c1`.

## Workspace UI verification — 2026-09-10

- Re-ran the current suite: 91 tests passed with no skips, including 11 workspace behavior checks and the existing 7 frontend behavior checks.
- Inline JavaScript syntax validation passed. Local verification used `outputs/run_checks.py` with the installed VS Code Electron Node runtime.
- Explicit UTF-8 decoding in frontend test subprocesses removes Windows CP949 reader-thread failures.
- Re-ran `python -m scripts.run_validation`: default Walker count 128, multi-shell count 200, and SGP4 reference error 0.00000682 m (within 1 m).
- Existing browser evidence in `outputs/browser-modes-report.json` covers six comparison rows, multi-shell/TLE preview and analysis, and mobile settings without horizontal overflow or runtime exceptions. Browser checks were not re-run in this completion pass.
- Remaining diagnostics: Starlette/httpx deprecation warning and an Electron crash-report permission diagnostic; checks exited successfully.

The checks below describe the earlier release verification, not a new packaging or deployment run.

## Executed checks

| Check | Result |
|---|---|
| pytest | 90 passed, no skips in this environment |
| Python compileall | PASS |
| Inline JavaScript node --check | PASS |
| Frontend function harness | PASS: 7 checks inside the pytest suite |
| Official SGP4 Vanguard epoch vector | PASS; position difference approximately 0.00000682 m |
| Wheel build and isolated installed-wheel import | PASS |
| Packaged production server over HTTP | PASS: health/version, HTML, simulation metadata, GLB asset |

Python 3.12.13, Node.js 24.19.0, uv 0.11.33, dependencies from uv.lock.
The suite emits one Starlette/httpx test-client deprecation warning; no test failed.

## Reproduced defects covered by regression tests

- Fully unavailable 120-second window reports 120 seconds, not 180 seconds.
- An outage followed by a different satellite counts as reconnection rather than a handover across the outage.
- Non-divisible duration/step includes the exact end time and uses interval weights.
- Walker propagation runs once per sample for all selected ground stations.
- Chunked heatmap counts match an independent dense elevation calculation.
- Below-horizon satellites are not direct access links, including internal calls with negative elevation masks.
- Invalid arrays/ranges, zero/subnormal time steps, NaN and reversed geographic bounds produce client errors.
- The expanded preset with three cities per country resolves 33 cities and simulates successfully under the new default limit.
- Busy compute slots return 503/Retry-After while health stays available; slots are released afterwards.
- Six candidate cases retain per-city metrics and stable input hashes; qualifying smaller constellations rank first.
- Scenario validation normalizes a round trip; invalid schemas and TLE timestamps are rejected.
- TLE and multi-shell use the same sampled outage definition.
- Shell identifiers that are prefixes of other identifiers resolve the correct satellite.
- Frontend harness checks serialized playback, invalidation, stale analysis responses, safe CSV cells, scenario save, export metadata, and rejection of invalid imports without altering existing settings.

## Heatmap measurement

Same case: 4,096 satellites, 60 × 60 grid, one service area, 1,280 km / 42°.
Each measurement ran in an isolated Python process using the corresponding core implementation.

| Measurement | V1.1.0 | V1.2.0 |
|---|---:|---:|
| Peak process RSS | 927.29 MiB | 28.55 MiB |
| Core calculation elapsed | 3.08 s | 1.07 s |
| Mean visible satellites | 154.09083333333334 | 154.09083333333334 |

These are local measurements, not Render production memory/latency guarantees. Python/API response serialization, Cesium rendering, concurrent jobs and process count change resource use.

## Limits of this validation

The remote browser connection closed during setup/navigation. A full browser/Cesium end-to-end scenario, visual GPU behavior, actual download/import interaction and device-specific layout were not verified. JavaScript behavior was checked with a deterministic DOM/network harness, and API scenario round trips were executed separately.

Docker Engine was unavailable. The Docker image and Render production deployment were not built/deployed; the installed wheel and its production entrypoint were exercised over HTTP. No precision orbit engine or full RF/network service-availability model is claimed.
