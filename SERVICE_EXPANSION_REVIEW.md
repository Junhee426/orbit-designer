# 서비스 확장 검토 (Service Expansion Review)

Test Orbit Designer V1.2.0을 실제 다중 사용자 공개 서비스로 확장한다는 관점에서
코드베이스를 검토한 결과입니다. 인증 시스템이나 데이터베이스 도입처럼 대규모
재설계가 필요한 항목은 범위 밖으로 두고, 지금 구조 안에서 안전하게 고칠 수 있는
동시성/부하 관련 이슈에 집중했습니다.

## 1. 현재 아키텍처 (동시성/스케일링 관점)

- 서버는 `app/server.py`의 `uvicorn.run(..., workers=N)`으로 기동하며, `N`은
  `WEB_CONCURRENCY` (또는 `RENDER_WEB_CONCURRENCY`, 1~8 사이로 clamp)로 결정됩니다
  (`app/server_config.py:worker_count`). 각 워커는 `app.main:app`을 **독립적으로
  다시 import하는 별도 프로세스**이므로, 프로세스 간에 메모리를 공유하지 않습니다.
- 무거운 계산 엔드포인트(`/api/simulate`, `/api/multi-shell/simulate`,
  `/api/tle/simulate`, `/api/snapshot`, `/api/orbital-geometry`,
  `/api/trade-study`)는 `bounded_compute` 데코레이터(`app/main.py`)로 감싸여 있고,
  이 데코레이터는 프로세스별 `threading.BoundedSemaphore`
  (`_COMPUTE_SLOTS`, 용량 = `KLEO_MAX_CONCURRENT_JOBS`를 워커 수로 나눈 값,
  올림 처리)에서 **non-blocking**으로 슬롯을 확보합니다.
  - 슬롯을 못 얻으면 즉시 `HTTPException(503, Retry-After: 1)`을 반환합니다.
  - 즉, 대기열(큐)이 아예 없습니다 — 요청이 쌓여 무한정 기다리는 구조가 아니라
    "받거나 즉시 거절하거나" 방식이라 요청이 스레드풀에 계속 쌓여 메모리를
    소모하는 형태의 리소스 누수는 없습니다. 이 점은 다중 사용자 서비스 관점에서
    이미 합리적으로 설계되어 있었습니다.
  - FastAPI의 동기 핸들러는 anyio 스레드풀(기본 40 토큰)에서 실행되는데, 세마포어
    용량이 그보다 훨씬 작아(기본 전체 2, 워커당 최소 1) 스레드풀 고갈로 이어지지도
    않습니다.
- 요청 검증 단계(`_enforce_*_limits`)에서 위성 수·지상국 수·샘플 수·"work"
  추정치를 계산해 `KLEO_MAX_*` 환경변수 한도를 넘으면 413으로 거절합니다. 이는
  한 요청이 과도한 CPU/메모리를 쓰는 것을 막는 정적 방어선이며, 지금 검토의
  범위인 "동시 다중 사용자" 이슈와는 직교하는 별도 보호장치입니다.
- 전역 가변 상태를 전수 조사한 결과 (`grep`으로 모듈 레벨 캐시/락/딕셔너리 탐색),
  `_COMPUTE_SLOTS`를 제외하면 요청 간에 공유되는 가변 전역 상태는 없습니다.
  `SETTINGS`는 불변(`frozen=True`) 데이터클래스이고, `service_regions.py`의
  국가/도시 카탈로그는 정적 튜플/데이터클래스로 읽기 전용입니다. 즉 "여러 요청이
  같은 전역 딕셔너리를 동시에 수정해서 데이터가 섞이는" 유형의 레이스 컨디션은
  발견되지 않았습니다.

## 2. 발견한 구체적 격차

1. **부하 가시성 부재(수정함)** — `/api/server-info`는 정적 한도(`limits`)만
   보여줄 뿐, "지금 몇 개의 작업이 실행 중인지", "얼마나 여유가 있는지"를 알 수
   있는 방법이 없었습니다. 클라이언트가 503을 맞기 전에 스스로 자제하거나,
   운영자가 특정 워커의 혼잡도를 모니터링할 방법이 없었습니다.
2. **`KLEO_MAX_CONCURRENT_JOBS`의 워커 분배 반올림 오차(문서화, 미수정)** —
   `max_concurrent_jobs_per_worker = ceil(max_concurrent_jobs / workers)`로
   계산되므로, 예를 들어 총 한도 2에 워커 3개면 워커당 1개씩 총 3개까지 동시
   실행이 가능해 설정값보다 최대 `workers - 1`만큼 더 관대해질 수 있습니다.
   프로세스 간에 세마포어를 공유하려면 `uvicorn`의 워커가 서로 다른 프로세스로
   `app.main`을 재-import하는 현재 기동 방식(`app/server.py`)을 부모 프로세스가
   `multiprocessing.Semaphore`를 만들어 자식에 넘기는 구조로 바꿔야 하는데,
   이는 "큰 재설계 없이" 범위를 벗어난다고 판단해 지금은 고치지 않고 아래 3절에
   문서화만 남깁니다. 실무적으로는 워커 수가 적을 때(1~2) 오차가 작아 당장
   위험도는 낮습니다.
3. **가짜 대기열/무제한 재시도 폭주 가능성은 없음(확인만 함)** — non-blocking
   acquire + 즉시 503 구조 덕분에, 다수 클라이언트가 한도를 초과해도 서버 쪽에
   쌓이는 대기 요청은 없습니다. 다만 클라이언트가 `Retry-After` 없이 즉시
   재시도를 반복하면 요청 자체(파싱, 검증, 스레드풀 획득)의 오버헤드는 여전히
   발생합니다 — 이는 인증/레이트리밋이 없는 공개 서버의 근본적 한계이며 4절에서
   "추후 과제"로 남깁니다.
4. **공정성(fairness)** — 세마포어가 non-blocking이라 대기열 자체가 없으므로
   "먼저 줄 선 사람이 계속 밀리는" 형태의 불공정은 발생하지 않습니다. 다만 한
   클라이언트가 허용 한도 내에서도 오래 걸리는 무거운 작업(예: 위성 수/지상국
   수가 한도에 근접한 요청)을 보내면 그 작업이 끝날 때까지 슬롯을 점유해 다른
   사용자가 503을 받을 수 있습니다. 이는 "사용자별 큐/쿼터"가 없는 현재 설계의
   알려진 한계이며, README에 이미 명시된 범위(공개 서버에는 인증·사용자별 작업
   큐가 없음)와 일치합니다 — 별도 수정 없이 4절에 명시적으로 재확인합니다.

## 3. 지금 변경한 사항

- **`app/main.py`**: `bounded_compute` 데코레이터에 워커-로컬 부하 카운터
  (`_active_jobs`, `_accepted_jobs_total`, `_rejected_jobs_total`)를 추가하고
  `threading.Lock`으로 보호했습니다. 세마포어 획득/해제와 함께 원자적으로
  갱신되어 레이스 없이 정확한 스냅샷을 제공합니다.
- **`/api/server-info`**: 새 `load` 섹션을 추가해 `active_jobs_this_worker`,
  `max_concurrent_jobs_this_worker`, `available_slots_this_worker`,
  `accepted_jobs_this_worker_total`, `rejected_jobs_this_worker_total`을
  노출합니다. 응답에 이 값이 **워커별(worker-local)** 값이며 멀티 워커 환경에서는
  요청이 어느 워커로 라우팅되느냐에 따라 달라질 수 있다는 점을 주석과 이 문서에
  명시했습니다 (`WEB_CONCURRENCY`로 인해 클러스터 전체 총합이 아님).
  - 이유: 클라이언트(웹 UI, 스크립트)가 503을 맞기 전에 현재 혼잡도를 확인해
    스스로 요청을 조절할 수 있게 하고, 운영자가 특정 워커의 상태를 즉시 진단할
    수 있게 하기 위함입니다. 인증/DB 없이도 구현 가능한 "관측 가능성" 개선입니다.
- **`tests/test_v12.py`**: 다음 테스트를 추가/보강했습니다.
  - 기존 `test_busy_server_rejects_work_and_keeps_health_live`가 세마포어
    용량(`max_concurrent_jobs_per_worker`)을 정확히 참조하도록 정리하고, 503
    발생 시 `_rejected_jobs_total`이 증가하는지 검증하도록 확장.
  - `test_server_info_reports_current_load_not_just_static_limits`: 정상 상태에서
    `load` 필드의 초기값과, 요청 처리 후 누적 카운터가 증가하는지 확인.
  - `test_load_counters_reflect_in_flight_job_while_it_runs`: 별도 스레드에서
    `bounded_compute`로 감싼 느린 작업을 실행 중일 때 `/api/server-info`가
    `active_jobs_this_worker >= 1`과 그만큼 줄어든 `available_slots_this_worker`를
    "작업이 끝나기 전에" 관측할 수 있는지 확인 — 카운터가 완료 후가 아니라
    진행 중에도 정확한지 검증하는 것이 핵심입니다.

## 4. 지금은 미루는 것 (추후 과제)

- **실제 인증/API 키/사용자별 쿼터**: README에 이미 명시된 대로 이번 검토의
  범위 밖입니다. 공개 서비스로 정식 확장하려면 사용자 식별 → 사용자별 동시
  작업 수·일일 호출량 제한 → 악성/과다 사용자 차단까지 이어지는 설계가
  필요합니다.
- **워커 간 세마포어 공유(정확한 전역 동시성 한도)**: 2절 항목 2에서 설명한
  반올림 오차를 없애려면 `multiprocessing.Semaphore` 또는 Redis 등 외부
  카운터로 워커 간 상태를 공유해야 합니다. 현재는 프로세스별 `uvicorn` 워커
  구조와 맞지 않아 별도 설계 작업으로 분리합니다.
- **`load` 정보의 클러스터 전체 집계**: 지금 추가한 `/api/server-info`의
  `load`는 요청을 받은 워커 하나의 값입니다. 여러 워커/여러 인스턴스를 로드밸런서
  뒤에 두는 배포에서는 Redis 같은 공유 저장소나 `/metrics` + Prometheus 같은
  중앙 집계가 있어야 "서비스 전체가 지금 얼마나 바쁜지"를 알 수 있습니다.
- **수평 확장(다중 인스턴스, 로드밸런서)**: 현재 상태 비저장(stateless) 계산
  엔드포인트들은 수평 확장 자체에는 문제가 없지만, 위의 인증/쿼터/집계 문제가
  먼저 해결되어야 여러 인스턴스를 안전하게 운영할 수 있습니다.
- **재시도 폭주 방어(레이트리밋)**: 503 후 클라이언트가 무제한으로 즉시
  재시도하는 것을 막는 IP/클라이언트 단위 레이트리밋은 이번에 추가하지
  않았습니다. 프록시/CDN 레벨(Cloudflare 등)에서 처리하거나, 사용자별 쿼터
  설계와 함께 나중에 추가하는 것이 합리적입니다.
