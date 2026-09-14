# K-LEO Orbit Lab — 브라우저 통합판 2.0

Orbit Designer의 Walker/J2·가시성 모델과 commnav의 통신·항법 모델을 브라우저에서 함께 실행합니다. FastAPI와 Python 계산 서버는 필요하지 않습니다.

## 실행

저장소 루트에서 Node.js 24.x로 실행합니다. Render와 같은 버전은 `.node-version`에 지정했습니다.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

`http://127.0.0.1:8080`을 엽니다. Windows는 루트의 `start_browser_windows.bat`, macOS/Linux는 `sh start_browser_mac_linux.sh`도 사용할 수 있습니다. 최초 설치·빌드에는 네트워크가 필요합니다. 준비 후에는 로컬 자산만으로 실행합니다.

Node는 개발·설치와 로컬 정적 파일 제공에 사용합니다. 위성 전파와 분석은 모두 브라우저에서 수행합니다. 웹에 배포된 앱을 쓰는 사용자는 Node·Python 설치가 필요 없습니다. ES 모듈과 Worker를 사용하므로 HTML을 `file://`로 직접 열지 말고 HTTP로 제공해야 합니다.

## 제공 기능

- 단일 Walker, 최대 8개 층의 Multi-shell, TLE/SGP4.
- Walker F와 J2 RAAN 보정. 같은 ECEF 위치·속도로 지도·통신·항법 계산.
- 한국만 초기 선택. 18개 국가 카탈로그, 국가당 1–3개 도시, 직접 입력 관측지.
- 로컬 Cesium 3D/2D 지도, 위성 선택, 지상궤적·풋프린트, ISL, 가시 위성 수 격자, 하늘보기.
- 기하 가시율·가시 위성 수·최장 표본 단절·기하 핸드오버·재접속.
- 통신 처리량·RF 마진·C/N·C/N₀·Eb/N₀·FSPL·도플러·편도 지연·통신 목표 충족률.
- GNSS / GNSS+LEO / 지역항법 포함 구성별 HRMS, 융합 VRMS·PDOP, 유효해 비율·항법 목표 충족률·동시 충족률.
- 기간·간격 선택, 종료 시각을 포함한 시간 가중 분석, 진행률·취소, 이전 설정 결과 표시.
- 6개 고도·위성 수 후보의 기간 비교, 현재 시각 6개 설계변수 민감도.
- 시나리오 v2 JSON 저장·복원·URL 공유, 기존 Orbit Designer v1/commnav JSON·공유 링크 변환, 전체 결과 JSON/CSV와 후보 결과 JSON. 저장 시 지도 차원·선택 위성·경과 시각도 보존합니다.

## 사용 순서

1. 궤도 모델·위성 수·국가·관측지를 설정합니다. 지도와 현재 지표가 갱신됩니다.
2. **가시성·통신·항법 분석**으로 선택한 모든 관측지의 기간 결과를 계산합니다.
3. 상단 상세 관측지를 바꾸면 해당 지점의 그래프·표를 봅니다. **관측지별 모든 지표** 표는 가로로 스크롤할 수 있습니다.
4. **후보 비교**에서 6개 Walker 후보의 동일 기간·관측지 성능을 비교합니다. 순간 민감도는 별도 영역입니다.
5. 설정과 결과는 파일로 저장합니다. 브라우저를 닫기 전에 필요한 설정·결과를 내보내세요. 현재 자동 저장과 PWA 설치 기능은 없습니다.

## 지표와 모델 범위

기하 가시율은 통신 최소 고도각 이상 위성이 보이는 시간 비율입니다. 통신·항법 충족률은 각각 지정 처리량·HRMS 목표 기준이며 모두 %입니다. 기간 집계는 `[t_i,t_(i+1))`에 왼쪽 표본을 적용합니다. 종료 표본에는 추가 시간을 부여하지 않습니다. 항법 불능 표본도 목표 충족률 분모에 포함하며, 중앙값은 종료 표본을 제외한 유효 표본으로 계산합니다.

J2는 기존 Python 엔진과 같은 **RAAN drift 보정**이며 전체 섭동 전파기가 아닙니다. TLE에는 SGP4를 적용하고 Walker J2 식을 중복 적용하지 않습니다. 이상화 GNSS·지역항법군의 궤도와 오차 가정은 실제 KPS·GNSS 운용 성능과 구별합니다.

Multi-shell ISL은 같은 층 내부 연결입니다. TLE ISL은 가까운 위성 간 LOS 예시 그래프이며 실제 운용 링크가 아닙니다. 경로 지연은 전파 시간만 포함합니다. 단일 위성의 최선 처리량은 네트워크 총용량과 다릅니다.

현재 경계 파일은 원본 프로젝트의 사각형 대체 데이터입니다. 격자는 국가별 **사각 분석 범위(해역 포함)**이며 정확한 국경 마스크·국가 전체 서비스 보장을 의미하지 않습니다. 도시 가시율은 해당 관측점만의 통계입니다.

총 Walker 4,096기, TLE 512기, 관측지 64개, 최대 3,001개 표본을 검증합니다. 표본×위성×관측지가 3천만을 넘으면 입력을 거부합니다. 지원 한도는 응답 시간 보장이 아니며 대규모 지도·격자·경로 계산은 기기 성능에 영향을 받습니다.

## 배포

Render 배포 절차는 루트의 [RENDER_STATIC_DEPLOYMENT_KO.md](../RENDER_STATIC_DEPLOYMENT_KO.md)를 참고하세요. 루트 `render.yaml`이 정적 사이트의 기본 Blueprint이며 이 폴더의 파일은 같은 설정의 사본입니다. `npm run build:render` 후 `standalone/` 전체를 정적 호스팅에 올립니다. `vendor/`를 빠뜨리지 않아야 합니다. 앱의 자산 참조는 상대경로이며 원격 계산 API·CDN을 사용하지 않습니다. 실제 외부 배포는 별도 수행합니다.

브라우저가 WebGL을 제공하지 않으면 간단 Canvas 지구본으로 대체합니다. 이 경우 Cesium의 2D 전환·위성 클릭·ISL·격자·풋프린트 지도 레이어는 제공되지 않지만 수치 분석과 위성 선택 목록은 사용할 수 있습니다.

## 검증

```sh
npm test
npm run test:browser
```

Python 기준 데이터는 `python scripts/generate_browser_reference.py`로 생성합니다(Python 프로젝트 의존성 설치 필요). 고도별 J2 켬/끔 위치·24시간 가시성, 수치 미분 속도·거리 변화율, SGP4 기준값, RF 마진, 독립 NumPy 항법 공분산, 기간 집계, 시나리오 복원, 경로를 검증합니다.

Playwright 검증은 기본 Windows Edge 또는 다른 OS의 Playwright Chromium을 사용합니다. 해당 브라우저를 준비해야 합니다. 실제 Worker·분석 취소·JSON 내보내기·설정 복원·모바일 폭·외부 요청 부재를 검증합니다.

## 구성과 출처

- `engine.js`: commnav 수치모델에서 확장한 공통 Walker/J2/TLE·통신·항법 엔진.
- `analysis.js`, `analysis-worker.js`: 관측지별 기간 분석·후보 비교.
- `scenario.js`: 버전 스키마, 입력 검증, 마이그레이션과 결과 메타데이터.
- `geometry.js`, `viewer.js`: ISL·경로·격자·풋프린트·Cesium 표시.
- `app.js`, `index.html`: 통합 UI와 파일 입출력.
- `catalog.json`, `boundaries.geojson`: 기존 Orbit Designer 카탈로그·대체 경계 데이터.
- `earth.jpg`: 기존 프로젝트의 NASA Blue Marble 이미지.
- `vendor/`: 고정 버전 Cesium·satellite.js 및 라이선스. `package-lock.json` 기반 빌드로 준비.

CesiumJS는 Apache-2.0, satellite.js는 MIT 라이선스이며 배포물에 해당 라이선스를 포함합니다. UI·항법/통신 계산은 로컬 commnav 프로젝트를 바탕으로 통합했습니다.
