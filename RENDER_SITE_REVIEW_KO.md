# test-orbit-designer.onrender.com 배포 코드 검토

확인일: 2026-09-27. 공개 사이트의 HTML, JavaScript, `/health` 응답과 저장소 코드를 비교했습니다. Render 계정의 서비스 설정은 조회하지 않았습니다.

## 실제 서비스되는 코드

- 사이트: https://test-orbit-designer.onrender.com/
- `/health`: `version: 1.2.0`, `mode: render`, `render: true`.
- HTML: `Test Orbit Designer V1.2.0`, `/static/app.js?v=7a608a7b34435b91`, `/static/workspace.css` 사용.
- 수정 전 공개 JavaScript는 저장소 `app/static/app.js`와 개행 정규화 후 일치했습니다. SHA-256: `7a608a7b34435b9185143811f17d1d06a63ff5e25ba0907cb74de23bd71406b3`.
- 실제 코드 경로는 `Dockerfile` → 설치된 Python 패키지 → `app/server.py` → `app/main.py` → `app/static/index.html`, `app/static/app.js`, `app/static/workspace.css`입니다.

## 발견 사항과 수정

1. **실행판 경로 차이**: 앞선 위성 테두리 변경은 브라우저 통합판 `standalone/`에 있었습니다. 이 주소의 Docker판은 해당 파일을 제공하지 않으므로 그 변경이 화면에 나타나지 않습니다. 이번에 `app/static/`에도 같은 표시 정책을 적용했습니다.
2. **반투명·크기 차이**: Docker판 `highlightSelection()`이 비가시 위성에 `.withAlpha(.45)`와 작은 크기를 적용했습니다. 가시 여부·선택 여부에 따른 본체 색상과 불투명도 분기를 제거하고, 동일 크기·단색·alpha 1로 바꿨습니다. 점 마커의 전체 지름은 테두리 두께를 포함해 일정하게 유지합니다. 3D 모델은 같은 최소 화면 크기와 단색 혼합 모드를 사용합니다.
3. **표시 모드 불일치**: 경량 지도는 고도·선택 여부에 따라 점 크기와 색상을 달리했습니다. 경량 지도도 같은 크기·색상·불투명도로 맞추고, 가시 위성 테두리 토글을 연결했습니다. 고도별 점 크기 안내와 기존 색상 범례도 수정했습니다.
4. **배포 설정 구분**: 루트 `render.yaml`은 `standalone/`을 공개하는 별도 Static Site(`kleo-orbit-lab-browser`) 설정이고, `render-docker.yaml`은 기존 `test-orbit-designer` Docker 서비스 설정입니다. 루트 YAML 변경만으로 기존 Docker 서비스가 Static Site로 전환되지는 않습니다. 기존 주소의 변경에는 `app/static/`을 포함한 Docker 재배포가 필요합니다.
5. **캐시 확인**: 확인 시 HTML은 `Cache-Control: no-store`, 앱 JS는 `no-cache`였습니다. `app/main.py`는 JS/CSS 내용 해시를 URL에 붙입니다. 코드 변경에 맞춘 캐시 무효화 경로가 있으며 이번에 캐시 정책을 변경할 필요는 없습니다.

## 검증 및 적용

- 브라우저 통합판: `npm run build:render`, `npm run test:browser`.
- Docker판: Python 프런트엔드·정적 자산·서버·배포 테스트와 `npm run test:render-ui`. 후자는 로컬 FastAPI 서버를 실행하고 브라우저에서 실제 API/렌더링을 확인합니다. Python 프로젝트 의존성과 `npm run build`로 준비한 Cesium 자산이 필요합니다. 필요하면 `KLEO_TEST_PYTHON`으로 Python 실행 파일을 지정할 수 있습니다.
- 이번 검토는 코드 수정과 로컬 검증입니다. 공개 사이트의 코드 교체·Render 재배포는 수행하지 않았습니다. Render에 연결된 GitHub 저장소·브랜치와 자동 배포 활성 여부는 계정 설정에서 별도로 확인해야 합니다.
- 배포 후 새로고침하여 **지구 및 위성 표시 → 가시 위성 테두리 강조**를 확인하고, 3D 모델·점 마커·2D·경량 지도에서 단색·불투명 표시와 토글 동작을 점검합니다.
