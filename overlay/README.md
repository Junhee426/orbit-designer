# Test Orbit Designer V1.2.0

LEO 위성군의 궤도·지상 가시성·3D 시각화와 K-LEO 후보망 비교를 위한 FastAPI + CesiumJS 도구입니다.

## V1.2.0 변경 사항

- 분석 종료시각을 포함하고 시간 간격으로 가시성 비율·평균 가시 위성 수·최대 단절시간을 계산합니다.
- 통신 단절 후 재접속을 연속 서비스 중 위성 전환(핸드오버)과 구분합니다.
- Walker / Multi-shell은 한 시각의 위성 위치를 모든 지상 지점에서 재사용합니다.
- Heat Map은 128개 지상 격자 × 256기 단위로 계산해 대형 임시 배열을 만들지 않습니다.
- 입력 범위·유한수·영역 경계·시간 간격을 검증하고 오류를 400/422 응답으로 반환합니다.
- 직접 가시성 최소고도각을 0~90°로 통일합니다.
- 재생은 응답 완료 후 다음 요청을 실행합니다. 입력 변경으로 무효화된 응답·분석값은 표시하지 않습니다.
- 국가/지역 변경 시 기존 KPI·그래프·결과 내보내기를 무효화하고 재분석을 안내합니다.
- 500/888/1,280 km × 8/16 궤도면 × 궤도면당 16기, 총 6개 후보를 동일 조건으로 비교합니다.
- 시나리오 JSON 저장/불러오기와 결과 JSON/CSV 내보내기를 제공합니다.
- 결과에 앱 버전·입력값·입력 SHA-256·분석기간·시간 간격·계산방법을 기록합니다.
- 기본 지상 지점 한도를 64개로 조정하고 동시 계산은 프로세스당 기본 2건으로 제한합니다.
- Docker는 `uv.lock`을 이용해 검증한 의존성 버전을 설치합니다.

## 실행

Python 3.12 및 uv를 사용하는 방법입니다.

```bash
uv sync --locked
uv run kleo
```

브라우저에서 `http://127.0.0.1:8000`을 엽니다. Windows는 `setup_windows.bat`, 이후 `start_windows.bat`을 사용할 수 있습니다. macOS/Linux는 대응하는 `.sh` 파일을 사용합니다.

기본값은 **1,280 km / 42° / 8 × 16 = 128기 / Walker F=1 / J2 RAAN drift On**입니다. 초기 카메라는 전지구 시점을 유지합니다.

## 분석·비교·저장 사용법

1. 궤도와 분석기간, 시간 간격을 설정합니다.
2. 서비스 국가와 국가당 주요 도시 수를 선택하고 **Apply service area**를 누릅니다.
3. **Run analysis**로 현재 구성의 지상 가시성을 분석합니다.
4. **Compare 500/888/1280 km**를 누르면 6개 후보를 비교합니다. 경사각·J2·분석기간·서비스 지점은 현재 조건을 사용하며, 비교 시간 간격은 현재 설정과 120초 중 큰 값입니다.
5. **Save scenario**로 설정을 JSON으로 저장하고, **Load scenario**로 복원합니다. 복원 후 Run analysis를 눌러 다시 계산합니다.
6. 계산이 완료되면 **Results JSON / Results CSV**로 결과를 저장합니다. JSON에는 후보별 도시 지표도 포함됩니다. CSV에는 입력 JSON과 계산조건도 포함됩니다.

후보 비교는 가시성 목표 95%를 만족한 후보를 먼저 보여주며, 만족 후보 사이에서는 위성 수가 작은 후보를 우선합니다. 미달 후보는 최저 지점 가시성 비율이 높은 순서로 표시합니다. 이는 비용 최적해나 통신 서비스 가용성 보장이 아닙니다.

## 지표 정의와 물리 모델 범위

`availability`는 **해당 지상 지점에서 최소고도각 이상인 위성이 1기 이상 보이는 시간의 비율**입니다. RF 링크 마진·강우·게이트웨이 연결·용량·위성 고장을 포함한 서비스 가용률은 아닙니다. 주요 도시의 지표를 국가 전체 면적의 지표로 해석하면 안 됩니다.

V1.2의 시간 적분은 **왼쪽 표본 유지(left-hold)** 방식입니다. `t[i]`의 상태를 `[t[i], t[i+1])`에 적용하며 종료 표본에 추가 시간을 부여하지 않습니다. 예를 들어 0/60/120초가 모두 단절이면 단절시간은 120초입니다. 150초 분석/60초 간격에서는 0/60/120/150초로 계산합니다.

단절 시작·종료시각은 표본 간격 수준의 오차가 있고, 표본 사이의 짧은 단절은 놓칠 수 있습니다. 설계 검토에서는 분석시간을 늘리고 시간 간격을 줄여 결과의 수렴을 확인하십시오. 짧은 분석 결과를 연간 서비스 가용률로 환산하지 마십시오.

유지되는 모델:

- 원형 2체 궤도, Walker-Delta T/P/F 위상, 선택적 J2 RAAN 세차
- 구면 지구 회전·지상 고도각·거리·전파지연
- 최소고도각 기반 Footprint, 날짜변경선 분할 Ground Track
- TLE/SGP4 위치 전파와 근사 TEME→지구고정 좌표 변환
- 단순 Ka 대역 링크 예시와 순간 ISL 경로(선택적 API 출력)

Walker는 T=0에서 기준 지구 회전각을 0으로 정의하는 상대시각 설계 모드입니다. TLE는 UTC epoch를 사용합니다. Walker에 J2의 모든 효과, 항력, 기동, SRP, 제3체 섭동을 추가한 정밀 전파 엔진은 아닙니다. Multi-shell ISL은 각 shell 내부만 지원합니다. TLE ISL은 실제 운용 링크가 아닌 시각화용 근접 LOS 그래프입니다. 이 버전의 재생은 연속 요청 방식의 표본 위치 갱신이며 프레임 간 궤도 보간은 포함하지 않습니다.

## 서버와 Render

```bash
PORT=10000 KLEO_SERVER_MODE=production uv run kleo-server
```

`/health`로 상태를 확인합니다. Docker/Render 설정은 저장소에 포함되어 있습니다. 공개 서버에는 인증·사용자별 작업 큐가 추가되지 않았습니다.

기존 환경변수가 있다면 확인하십시오.

```text
KLEO_MAX_STATIONS=64
KLEO_MAX_CONCURRENT_JOBS=2
```

이미 설정된 `KLEO_MAX_STATIONS=24`는 소스 변경만으로 덮어쓰지 않습니다. Render의 기존 환경변수도 별도로 조정해야 합니다. 동시 계산 제한은 **프로세스별**이므로 WEB_CONCURRENCY가 늘면 전체 동시 계산 수도 늘어납니다. 계산이 꽉 차면 HTTP 503과 Retry-After 헤더를 반환합니다. 위성 수·지점 수·표본 수에 따른 기존 작업량 제한도 유지합니다.

`/api/simulate`는 기본적으로 모든 지상 지점 쌍의 순간 경로 계산을 생략합니다. 필요한 경우 `include_routes: true`를 지정합니다. 이는 분석 전체 기간의 네트워크 가용률 계산과 별개입니다.

## 내부망 / 오프라인 준비

인터넷 연결이 가능한 컴퓨터에서 다음 명령으로 Cesium/Natural Earth 자산을 설치한 뒤 프로젝트를 옮깁니다.

```bash
uv run kleo-bootstrap-assets
```

기본 ZIP에는 지구 이미지·위성 GLB·Plotly가 포함되지만 Cesium/Natural Earth 전체 자산과 Python 실행환경은 포함되지 않습니다. 최초 환경 준비에는 네트워크가 필요합니다.

## API

| API | 용도 |
|---|---|
| GET /health | 상태·버전 |
| GET /api/server-info | 기능·서버 제한 |
| POST /api/simulate | 단일 Walker 지상 가시성 |
| POST /api/multi-shell/simulate | 다중 shell 지상 가시성 |
| POST /api/tle/simulate | TLE/SGP4 지상 가시성 |
| POST /api/snapshot | 현재 위치·레이어 |
| POST /api/orbital-geometry | 선택 위성 궤적·Footprint |
| POST /api/trade-study | 후보망 비교 |
| POST /api/scenario/validate | 시나리오 검증·정규화 |

스키마 상세는 서버 실행 후 `/docs`에서 확인합니다. 시나리오 예시는 `examples/scenario_v1_2.json`입니다.

## 검증

```bash
uv run pytest
uv run python -m scripts.check_frontend
uv run kleo-validate
```

프런트엔드 함수·구문 테스트에는 Node.js가 필요합니다. Node.js가 없으면 해당 pytest 항목이 건너뛰어집니다. 검증 범위와 결과는 `VALIDATION_REPORT.md`, 적용 절차는 `UPGRADE_V1_2_KO.md`를 참고하십시오.
