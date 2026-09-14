# Render 정적 사이트 배포 — K-LEO Orbit Lab 2.0

이번 배포는 **브라우저에서 계산하는 통합판**입니다. 저장소 루트의 `render.yaml`은 정적 사이트를 생성합니다. 기존 Python/Docker 서비스는 `render-docker.yaml`에 별도로 보관했습니다.

## 1. GitHub에 올릴 파일

이번 변경 파일들을 배포할 GitHub 브랜치에 커밋하고 푸시합니다. 특히 다음을 포함하세요.

```text
render.yaml
.node-version
package.json
package-lock.json
scripts/build-standalone.mjs
scripts/verify-standalone.mjs
standalone/                    # 앱 코드, 이미지, 카탈로그, TLE 예제
tests/standalone/              # 수치 검증 코드와 reference.json
examples/scenario_v1_2.json     # 기존 설정 변환 검증에 사용
```

`node_modules/`, `.venv/`, `outputs/`, `standalone/vendor/`는 올리지 않습니다. 지도 라이브러리와 SGP4 모듈은 Render 빌드에서 lockfile 기준으로 설치·복사합니다. 특히 `standalone/` 소스가 아직 untracked 상태라면 반드시 커밋에 포함해야 합니다.

## 2. Blueprint로 배포 — 권장

1. Render Dashboard에서 **New → Blueprint**를 선택합니다.
2. 위 파일들을 올린 GitHub 저장소와 브랜치를 연결합니다.
3. Blueprint 경로는 저장소 루트의 **`render.yaml`**을 사용합니다.
4. 생성할 서비스가 **`kleo-orbit-lab-browser` / Static Site**인지 확인하고 배포합니다.

Render는 기본적으로 저장소 루트의 `render.yaml`을 읽습니다. 정적 사이트는 `type: web`과 `runtime: static`으로 정의하며, 이번 설정에 이를 반영했습니다. [Render Blueprint 문서](https://render.com/docs/blueprint-spec)

기존 Docker Web Service에 정적 사이트 설정을 덮어씌우는 대신 새 **Static Site**를 만듭니다. 기존 서비스에서 사용하던 사용자 지정 도메인을 이전할 경우에는 새 사이트 확인 후 별도로 옮기세요.

## 3. 직접 Static Site를 만들 때

**New → Static Site**에서 같은 GitHub 저장소를 연결하고 아래 값을 입력합니다.

| 항목 | 값 |
|---|---|
| Name | `kleo-orbit-lab-browser` |
| Branch | 이번 변경을 푸시한 브랜치 |
| Root Directory | **비워 둠** — 저장소 루트 사용 |
| Build Command | `npm ci --ignore-scripts --include=dev --no-audit --no-fund && npm run build:render` |
| Publish Directory | `standalone` |
| Environment Variable | `SKIP_INSTALL_DEPS=true` |
| Node.js | `.node-version`의 `24.19.0` 사용 |

Root Directory에 `standalone`을 넣으면 루트의 `package.json`과 빌드 스크립트를 찾지 못합니다. Publish Directory에만 `standalone`을 넣습니다. Static Site에는 `npm start`, PORT, Python 설정, `/health` 검사가 필요 없습니다.

`SKIP_INSTALL_DEPS=true`는 Render의 자동 의존성 설치를 끄고 지정한 `npm ci`를 사용하게 합니다. [Render 정적 사이트 문서](https://render.com/docs/static-sites)

이전에 `NODE_VERSION` 환경변수를 설정했다면 `.node-version`보다 우선합니다. 해당 값을 제거하거나 `24.19.0`으로 맞추세요. [Render Node 버전 문서](https://render.com/docs/node-version)

직접 만든 사이트의 Headers에는 다음 규칙을 추가합니다. Blueprint를 사용하면 자동 적용됩니다.

```text
Path: /*
Name: Cache-Control
Value: public, max-age=0, must-revalidate
```

설정 공유 링크는 URL hash를 사용하므로 별도 SPA catch-all rewrite는 필요하지 않습니다. 없는 JS·Worker 경로를 `index.html`로 돌려보내는 규칙은 추가하지 마세요.

## 4. 빌드에서 확인하는 것

`npm run build:render`는 다음 순서로 실행됩니다.

1. Cesium·satellite.js와 라이선스를 `standalone/vendor/`에 준비하고 앱 JavaScript 문법을 검사합니다.
2. HTML·JS·CSS 상대경로, Linux 파일명 대소문자, Worker·지도·이미지·데이터 자산, 모델 버전과 Blueprint 일치를 검사합니다.
3. J2 위치·속도, SGP4, RF 마진, 항법 공분산, 기간 집계, 시나리오 복원·경로 등의 Node 테스트를 실행합니다.

빌드 로그에 `Static deployment verified`와 테스트 통과가 나오면 정적 배포물이 준비된 것입니다. 빌드 단계는 Python·브라우저 설치를 요구하지 않습니다. 실제 브라우저 UI 검증은 로컬의 `npm run test:browser`로 별도 실행합니다.

GitHub Actions에도 Linux에서 같은 빌드를 실행하고 `orbit-lab-static-site` 산출물을 보관하는 작업을 추가했습니다.

## 5. 배포 후 확인

- 발급된 `https://<사이트명>.onrender.com/`에서 지구본과 하늘보기가 표시되는지 확인합니다.
- 초기 국가는 대한민국만 선택되고 J2 보정이 켜져 있어야 합니다.
- 기간 분석 후 기하 가시율·통신·항법·동시 충족률과 도시별 표가 표시되어야 합니다.
- 설정 저장·불러오기, 결과 JSON/CSV, TLE 예제가 동작해야 합니다.
- `/build.json`, `/analysis-worker.js`, `/vendor/cesium/Cesium.js`가 열리는지 확인합니다.
- 새 배포 후 기존 탭도 새로고침하여 같은 버전의 화면·엔진을 사용합니다.

이번 작업은 저장소의 배포 준비와 로컬 검증입니다. GitHub 푸시, Render 계정 연결 및 실제 서비스 생성은 수행하지 않았습니다.
