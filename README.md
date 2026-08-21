# Test Orbit Designer V1.0.0

저궤도 위성통신망의 위성군·서비스 가용도·Coverage·ISL·Access를 설계하고 CesiumJS에서 시각화하는 Python/FastAPI 웹 애플리케이션입니다.

V1.0.0은 기존 V1.4.2 기능을 유지하면서 **Render Web Service에 GitHub 저장소를 연결해 브라우저 서비스로 바로 배포**할 수 있도록 서버 배포 구조를 추가했습니다.

## 주요 분석/시각화 기능

- Walker-Delta T/P/F 위성군
- 2-body + 선택적 J2 RAAN drift
- TLE / SGP4
- CesiumJS WGS84 3D Earth
- Offline NASA Blue Marble / Online ArcGIS World Imagery
- 4종 3D satellite GLB / outline 없는 Point Marker
- Earth on/off / opacity / satellite size
- orbit / ISL / Access line
- 국가별 Coverage surface overlay
- 서비스 국가/지역 Multi-select
- 주요 도시 service station 자동 생성
- satellite selection / properties
- time playback
- service availability / handover / link budget / trade study

## V1.0.0 추가 기능

- `Dockerfile`
- Render Blueprint `render.yaml`
- production entrypoint `kleo-server`
- Render `$PORT` 자동 사용
- `0.0.0.0` bind
- `/health` HTTP health check
- `/api/server-info`
- stateless multi-user request architecture
- public-server workload limits
- GZip middleware
- request ID / security response headers
- `/static/*` cache policy
- `robots.txt` indexing disable
- Docker Compose local production test
- Singapore Render region 기본 설정

## 가장 빠른 Render 배포

### 1. 이 프로젝트를 GitHub 저장소에 업로드

저장소 루트에 다음 파일이 있어야 합니다.

```text
Dockerfile
render.yaml
pyproject.toml
app/
scripts/
```

### 2. Render에서 Blueprint 생성

```text
Render Dashboard
  → New
  → Blueprint
  → GitHub repository 선택
  → Apply
```

Render가 저장소의 `render.yaml`을 읽어 Web Service를 생성합니다.

기본 Blueprint:

```text
Runtime       Docker
Region        Singapore
Plan          Free
Health check  /health
Auto deploy   every commit
```

배포가 완료되면 다음과 같은 URL이 생성됩니다.

```text
https://k-leo-orbit-designer.onrender.com
```

실제 서비스 이름에 따라 주소는 달라집니다.

상세 절차는 `RENDER_DEPLOYMENT.md`를 참고하세요.

## Render 서버 실행 구조

```text
Browser
   │
   │ HTTPS
   ▼
Render Edge
   │
   ▼
Docker Web Service
   │
   ├─ FastAPI
   │    ├ Walker / SGP4
   │    ├ Coverage
   │    ├ ISL / Routing
   │    └ Trade Study
   │
   └─ Static frontend
        ├ CesiumJS UI
        ├ Blue Marble
        ├ GLB satellites
        └ Plotly
```

브라우저별 시나리오 상태는 서버 전역에 저장하지 않습니다. 각 API 요청에 설정을 포함하므로 여러 사용자가 서로 다른 고도·경사각·서비스 국가를 동시에 분석해도 설정이 섞이지 않습니다.

## Render PORT 처리

Render 서버에서는 다음 명령을 직접 입력할 필요가 없습니다.

`app.server`가 자동으로:

```text
host = 0.0.0.0
port = $PORT
```

를 사용합니다. `$PORT`가 없으면 10000을 기본값으로 사용합니다.

## 로컬 개발

```bash
uv python install 3.12
uv sync
uv run kleo
```

브라우저:

```text
http://127.0.0.1:8000
```

개발 모드:

```bash
uv run kleo --reload
```

## 로컬 Server Edition 실행

Render와 유사하게 실행하려면:

```bash
PORT=10000 KLEO_SERVER_MODE=production uv run kleo-server
```

Windows PowerShell:

```powershell
$env:PORT="10000"
$env:KLEO_SERVER_MODE="production"
uv run kleo-server
```

접속:

```text
http://127.0.0.1:10000
```

## Docker local test

```bash
docker compose up --build
```

접속:

```text
http://127.0.0.1:10000
```

## Server workload limits

Render 공개 서비스에서 비정상적으로 큰 분석 요청이 서버를 점유하지 않도록 기본 계산 상한을 적용합니다.

```text
KLEO_MAX_SATELLITES          4096
KLEO_MAX_TLE_SATELLITES      512
KLEO_MAX_STATIONS              24
KLEO_MAX_COVERAGE_AREAS        18
KLEO_MAX_HEATMAP_POINTS         60
KLEO_MAX_SIM_SAMPLES          3000
KLEO_MAX_TRADE_CASES            64
```

추가 workload 상한도 `render.yaml`과 `.env.example`에서 조정할 수 있습니다.

기본 1280 km / 42° / 8×16 = 128기 시나리오는 기본 상한보다 충분히 작습니다.

상한 초과 요청은 HTTP `413`으로 거절됩니다.

## Server endpoints

```text
GET  /                         CesiumJS web UI
GET  /health                   Render health check
GET  /api/server-info          server/deployment metadata
GET  /docs                     FastAPI Swagger UI
GET  /api/service-regions/catalog
POST /api/service-regions/resolve
POST /api/snapshot
POST /api/simulate
POST /api/tle/parse
POST /api/tle/simulate
POST /api/trade-study
```

## Cesium / Earth Asset 정책

Render 공개 배포에서는 Docker image 크기를 줄이기 위해 다음 구조를 사용합니다.

```text
CesiumJS runtime
  local vendor가 있으면 local
  없으면 official Cesium CDN

Earth
  Online: ArcGIS World Imagery
  failure → local Blue Marble fallback

Satellite GLB
  always local
```

프로젝트에 포함된 로컬 Asset:

```text
app/static/earth_blue_marble_2048.jpg
app/static/kleo_satellite.glb
app/static/kleo_satellite_compact.glb
app/static/kleo_satellite_broadband.glb
app/static/kleo_satellite_flatpanel.glb
app/static/service_boundaries_fallback.geojson
```

완전 self-contained Docker image가 필요하면 인터넷 연결 환경에서:

```bash
uv run kleo-bootstrap-assets
```

으로 CesiumJS와 Natural Earth 경계 데이터를 vendor한 뒤 image를 빌드할 수 있습니다.

## Render Free와 운영용 Plan

`render.yaml`은 최초 테스트가 쉽도록 `plan: free`를 기본값으로 둡니다.

Free Web Service는 개발/검증용으로 사용하고, 실제 상시 업무 서비스는 Render Dashboard 또는 `render.yaml`에서:

```yaml
plan: starter
```

이상으로 변경하는 것을 권장합니다.

## 검증

```bash
uv run pytest -ra
uv run kleo-validate
```

V1.0.0 검증 결과:

```text
51 passed
1 skipped
Python compileall       PASS
JavaScript node check   PASS
render.yaml parse       PASS
Python wheel build      PASS
Production HTTP smoke   PASS
```

실제 production entrypoint를 `$PORT=18081`로 실행해 다음을 검증했습니다.

```text
/health                         200
/                               200
/static/kleo_satellite.glb      200
/api/server-info                200
/api/snapshot                   200
```

K-LEO snapshot:

```text
satellites   256
orbit paths   16
ISL links    512
```

현재 검증 sandbox에는 Docker engine이 없어 `docker build` 자체만 실행하지 못했습니다. 대신 Dockerfile이 설치하는 Python wheel을 빌드하고, Docker `CMD`와 동일한 `kleo-server` production process를 실제 HTTP로 검증했습니다.

## 프로젝트 구조

```text
Dockerfile
render.yaml
docker-compose.yml
.env.example
RENDER_DEPLOYMENT.md

app/
  main.py
  server.py
  server_config.py
  cli.py
  core/
  static/

scripts/
tests/
```

## 정확도 범위

본 도구는 LEO 위성통신망 개념설계·정책·Trade Study용입니다. Walker 모드는 2-body/J2 중심이며 TLE 모드는 `sgp4` 라이브러리를 사용합니다. STK HPOP/Orekit 수준의 고정밀 flight dynamics를 대체하도록 검증된 것은 아닙니다.
