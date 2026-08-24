# Test Orbit Designer V1.1.0

저궤도(LEO) 위성군의 궤도 구성, 서비스 가시성, 3D 시각화 및 초기 Trade-off 분석을 위한 FastAPI + CesiumJS 기반 웹 도구입니다.

V1.1.0은 V1.0.0의 Render 서버 구조와 Walker/TLE/Coverage/ISL 기능을 유지하면서 **Orbital Analysis** 기능을 확장합니다.

## V1.1.0 핵심 추가 기능

### 1. Selected Satellite Ground Track
- 3D 지구에서 Walker 또는 Multi-shell Walker 위성을 클릭하면 해당 위성의 지상궤적을 표시합니다.
- 기본 표시 범위: 현재 시각 중심 ±110분(총 220분).
- 날짜변경선(±180°) 통과 시 선을 자동 분할하여 지구를 가로지르는 잘못된 직선을 방지합니다.
- UI에서 Ground track 표시 ON/OFF 및 span(30~720분)을 조정할 수 있습니다.

### 2. Minimum-elevation Footprint
- 선택 위성의 현재 Sub-satellite point를 중심으로 서비스 footprint를 표시합니다.
- 구면 지구 모델에서 최소고도각 `E`에 대한 Earth-central half angle은 다음과 같습니다.

```text
psi = acos((R_E / (R_E + h)) cos(E)) - E
```

- 지표면 footprint 반경은 `R_E * psi`입니다.
- 직접 LOS는 지평선 아래로 확장할 수 없으므로 footprint 계산에서 `E < 0°`는 0°로 제한합니다.
- 예: 1280 km, 최소고도각 20°에서 footprint 지표 반경은 약 2,059 km입니다.

### 3. Multi-shell Walker
Propagation mode에 `Multi-shell Walker`가 추가되었습니다.

기본 예시:

| Shell | Altitude | Inclination | Planes | Sats/plane | Total |
|---|---:|---:|---:|---:|---:|
| SH1 Core | 1280 km | 42° | 8 | 16 | 128 |
| SH2 High-inclination | 600 km | 70° | 6 | 12 | 72 |
| **합계** | | | | | **200** |

- Shell 추가/삭제 가능
- Shell별 고도, 경사각, planes, sats/plane, Walker F, J2 설정
- 모든 shell을 합산해 서비스 가시성/Heat Map/Access를 계산
- 궤도선은 shell별로 생성
- V1.1 ISL은 **각 shell 내부 Walker ISL**만 생성하며 cross-shell ISL은 아직 포함하지 않습니다.

### 4. Cesium Layer Controls
기존 Earth / Orbit / ISL / Access / Coverage와 함께 다음 레이어가 추가되었습니다.

- Selected ground track
- Selected footprint
- Ground track span

위성을 클릭할 때 Ground Track/Footprint만 별도 API로 요청하므로 전체 Heat Map을 매번 다시 계산하지 않습니다.

## 기본 Single-shell 설정

```text
Altitude        1280 km
Inclination       42 deg
Planes              8
Sats / plane       16
Walker F             1
J2 RAAN drift       On
Total satellites   128
```

## 실행

Python 3.12 + uv 권장:

```bash
uv sync
uv run kleo
```

개발 자동 reload:

```bash
uv run kleo --reload
```

브라우저:

```text
http://127.0.0.1:8000
```

## Render 배포

GitHub 저장소 root에 다음 파일이 있어야 합니다.

```text
Dockerfile
render.yaml
pyproject.toml
app/
```

Render에서 `New -> Blueprint`로 저장소를 연결합니다. V1.1.0의 `render.yaml`은 Free tier와 호환되도록 `maxShutdownDelaySeconds`를 포함하지 않습니다.

Health check:

```text
/health
```

Render가 제공하는 `$PORT`를 `kleo-server`가 자동 사용합니다.

## 내부망 / Offline Cesium

인터넷이 되는 환경에서 먼저:

```bash
uv run kleo-bootstrap-assets
```

을 실행하면 로컬 CesiumJS와 Natural Earth 국가경계 asset을 설치할 수 있습니다.

주요 위치:

```text
app/static/vendor/cesium/
app/static/ne_50m_admin_0_countries.geojson
app/static/earth_blue_marble_2048.jpg
```

## 주요 API

### Health

```text
GET /health
```

### Single Walker snapshot

```text
POST /api/snapshot
mode = walker
```

### Multi-shell snapshot

```text
POST /api/snapshot
mode = multi_shell
shells = [...]
```

예제 payload는 `examples/multishell_v1_1.json`을 참고하십시오.

### Multi-shell service simulation

```text
POST /api/multi-shell/simulate
```

### Selected satellite Ground Track + Footprint

```text
POST /api/orbital-geometry
```

Single Walker 예:

```json
{
  "mode": "walker",
  "satellite_id": "P01-S01",
  "time_sec": 0,
  "altitude_km": 1280,
  "inclination_deg": 42,
  "planes": 8,
  "sats_per_plane": 16,
  "phasing": 1,
  "j2": true,
  "min_elevation_deg": 20,
  "ground_track_span_min": 220
}
```

Multi-shell 예:

```json
{
  "mode": "multi_shell",
  "satellite_id": "SH2-P01-S01",
  "time_sec": 0,
  "min_elevation_deg": 20,
  "shells": [
    {
      "id": "SH1",
      "name": "Core 1280 km",
      "altitude_km": 1280,
      "inclination_deg": 42,
      "planes": 8,
      "sats_per_plane": 16,
      "phasing": 1,
      "j2": true
    },
    {
      "id": "SH2",
      "name": "High-inclination supplement",
      "altitude_km": 600,
      "inclination_deg": 70,
      "planes": 6,
      "sats_per_plane": 12,
      "phasing": 1,
      "j2": true
    }
  ]
}
```

## V1.1 물리 모델 범위

현재 Walker 기반 분석은 다음을 포함합니다.

- Newtonian two-body circular orbit
- Kepler mean motion / orbital period
- Walker-Delta T/P/F phasing
- J2 secular RAAN drift
- Earth rotation (ECI -> ECEF)
- Ground-station elevation / slant range
- Earth occultation for ISL
- Minimum-elevation spherical footprint
- Ground track
- Propagation delay
- Basic Ka-band link budget
- TLE / SGP4 mode (sgp4 package가 설치된 환경)

아직 정밀 Walker propagator에는 atmospheric drag, J3/J4+, Sun/Moon third-body, SRP, maneuver/station-keeping은 포함하지 않습니다.

## V1.1 설계 의도

V1.1은 정밀 궤도결정 도구가 아니라 **LEO constellation orbital/service geometry를 빠르게 설계하고 비교하는 engineering tool**입니다. 대규모 위성군 분석은 기존 빠른 analytical propagator를 유지하고, 추후 Precision Mode를 별도 엔진으로 추가하는 구조를 권장합니다.

## 테스트

```bash
uv run pytest
```

V1.1.0 검증에는 기존 회귀시험과 다음 항목이 포함됩니다.

- Ground Track 날짜변경선 처리
- Footprint 공식과 최소고도각 변화
- Multi-shell snapshot
- Multi-shell service simulation
- Multi-shell satellite geometry
- Render Free-tier Blueprint contract
- UI layer contract

자세한 결과는 `VALIDATION_REPORT.md`를 참조하십시오.
