# N1_SESSION_M_HEALTH_RECOVERY_REPORT.md

> **SESSION M — N°1 RUNTIME RESILIENCE** · TASK 30 · RC0 기준 · 2026-09-09
> 브랜치: **`n1-session-m-health-recovery`** (기반 = `n1-personalization-integration` @ `c7417ad` 워킹트리)
> 신규 파일만 추가 — 기존 세션 소유 파일 1행 미수정.
> 결과: **health/readiness 6 경로 구현 · process auto-restart 실측 복구 2초 ·
> port rebind 실측 확인 · alert spam 방지 selftest 8/8 + 실측 억제 확인 ·
> 회귀 183/183 PASS · tsc clean · `next build` ok.**

---

## 0. 요약 — 무엇을 만들었나

Windows/local launch architecture(= `next start -p PORT` 단일 프로세스 + node .cjs
스크립트 + Git Bash)의 **연장선**에서 프로세스 자동 감시·재시작 체계를 만들었다.
PM2·NSSM·Windows 서비스·Docker 등 새로운 infra는 도입하지 않았다 — 기존 관용
(`stock_watcher.cjs`, `qa-proxy*.cjs`와 같은 "node .cjs") 그대로의 supervisor 하나.

| 산출물 | 소유 | 내용 |
| --- | --- | --- |
| `ops/n1_supervisor.cjs` | **M 신설** | 감시 루프 · backoff 재시작 · crash-loop HOLD · hang 재기동 · readiness 게이트 · 포트 반납 대기 · 로그 로테이션 · Telegram alert(기존 채널 재사용) · spam guard · selftest |
| `app/api/health/route.ts` | **M 신설** | 프로세스 로컬 liveness API — 외부 의존 호출 0, 시크릿 비노출(boolean만) |
| `ops/logs/` · `ops/state.json` · `ops/supervisor.pid` | M 런타임 아티팩트 | `.gitignore` 등록(커밋 안 함) |
| `N1_HEALTH_RECOVERY_RUNBOOK.md` | M 신설 | 운영 절차 + 장애 시나리오별 대응 |

## 1. 대상 판정 — "Storefront"와 "App/API"는 한 프로세스다

이 아키텍처에서 Storefront(페이지)와 App/API(라우트)는 **같은 Next.js 프로세스의
두 표면**이다. 따라서 재시작 단위는 프로세스 1개이며, 감시는 표면별로 분리해 판정한다:

| 감시 대상 | 판정 방법 | 주기 |
| --- | --- | --- |
| App/API (프로세스 liveness) | `GET /api/health` 200 (외부 호출 없음) | 10초 (fast) |
| Storefront (페이지 표면) | `GET /` 200 | 10초 (fast) |
| Orders path | `POST /api/orders` 빈 본문 → **400** (시트 쓰기 없는 계약 프로브 — Session H 스모크 #4와 동일) | 5분 (slow) |
| Stock service | `GET /api/stock?sku=PRD-N1-01` → 200 + `contractVersion: n1.stock.v1` | 5분 (slow) |
| HERMES path | bridge 디렉토리(inbound/outbound/escalations) + `ledger.json` 가독 + inbound 정체 관찰 — **재시작 대상 아님, 관찰 대상**(HERMES는 외부 오케스트레이터) | 5분 (slow) |
| Telegram path | `N1_CS_BOT_TOKEN`/`N1_CS_CHAT_ID` **구성 존재만** 판정 — 프로브로 메시지를 보내지 않는다(spam 원천 차단) | 5분 (slow) |

liveness 실패는 연속 3회(30초) hang 판정 후 트리 kill → 재기동. slow readiness FAIL은
**연속 2회**부터 alert(외부 의존 — Sheets 등 — 의 일회성 블립을 CRITICAL로 승격 금지).

## 2. Auto-restart 설계 (기존 구조와의 정합)

```
프로세스 사망 감지 (child exit, ~3ms 내)
  → backoff 1s→2s→4s→…→30s cap 재시작 예약
  → 포트 반납 폴링(최대 15s) 확인 — "port 3322 반납 확인 — rebind 진행" 로그
  → next start 재기동
crash-loop 가드: 10분 내 5회 비정상 종료 → HOLD(5분마다 1회 재시도) + CRITICAL alert
hang: 프로세스 생존 + HTTP 연속 3회 실패 → 트리 kill 후 재기동
웜업 한도: spawn 후 90초 내 readiness 미성립(예: 500 루프) → 기동 실패 판정, 재기동
단일 인스턴스 가드: ops/supervisor.pid lock — 이중 supervisor 기동 거부(exit 3)
```

선택 근거: 이 환경의 모든 런처가 plain node 스크립트이다. 서비스 래퍼를 새로
도입하면 launch 문서·runbook·소유권이 모두 갈라진다 — 한 파일(`ops/n1_supervisor.cjs`)
로 기존 방식을 그대로 강화하는 것이 "가장 기존 구조와 맞는" 방식이다.

## 3. Alert — 기존 채널 재사용 + spam 방지

- 발송 경로: **`lib/telegram.ts`의 `sendTelegramMessage`를 그대로 재사용**(TS transpile
  로딩은 `stock_watcher.cjs`와 동일 방식) + 기존 env `N1_CS_BOT_TOKEN`/`N1_CS_CHAT_ID`.
  앱의 CS escalation·주문 알림과 같은 코드 경로, 같은 api.telegram.org 고정 호스트 가드.
- spam 방지(3층, `ops/state.json`에 영속 — supervisor 재시작에도 유지):
  1. 컴포넌트별 cooldown 30분
  2. 전역 상한 시간당 5건
  3. 동일 상태 연속 중복 억제 → 지속 장애는 시간당 1회로 수렴
- 상태 전이는 예외: RECOVERED는 cooldown 면제(단 전역 상한 적용), 복구 후 새 장애는 즉시 1건.
- **새 장애 = 즉시 1건 → 동일 상태 지속 = 30분+1h window로 시간당 1회 케이던스**
  (selftest 8/8로 단언, 네트워크 0).
- 값 비노출: alert 본문·로그·state.json에 토큰/키 값 일절 없음(env 존재 boolean만).

## 4. 실측 검증 (2026-09-09, port 3322, RC0 코드)

| # | 검증 | 결과 |
| --- | --- | --- |
| V1 | 6 경로 readiness | **전부 OK** — storefront 200 · health 200 · orders 400 계약 · stock n1.stock.v1 · hermes WARN(정상 경로, §6) · telegram configured |
| V2 | process crash | `taskkill /F` → 감지 3ms → backoff 1s → **복구까지 실측 2초**(09:04:23 kill → 09:04:25 200) |
| V3 | port rebind | exit 후 "port 3322 반납 확인 — rebind 진행" 로그 → 신규 pid 바인딩 확인 (pid 7472 → 22008) |
| V4 | state persistence | `ops/state.json`에 exit 이력·재시작 카운트·alert 쿨다운 영속 확인. **재시작 후 주문 멱등성은 Orders 시트 `멱등키` 컬럼(2층)으로 유지**, stock은 시트 1순위→bridge ledger 미러(디스크)로 유지 — 재시작 무관 |
| V5 | logs | `ops/logs/supervisor.log`(감시 이벤트) · `app-stdout.log` · `app-stderr.log`(자식) 5MB 로테이션 3세대 — restart 체인 전체가 타임스탬프로 기록됨 |
| V6 | HERMES recovery | 전체 crash/restart 사이클 후 `stock_watcher.cjs --status` 정상 응답("원장 0건 … 키 주입: 없음(bridge)") — 파이프라인 무손상, 상태 정직 보고. `/api/stock` 재시작 후 계약 200 유지 |
| V7 | Telegram alert 경로 | **실발송 4건 모두 `ok:true`**(§5 정직 기록) + 63초 후 중복 프로브가 cooldown 억제된 것을 로그로 실측 |
| V8 | spam guard 로직 | `--selftest` **8/8 PASS**(네트워크 0) |
| V9 | 회귀 | 기존 테스트 **183/183 PASS** · `tsc --noEmit` clean · `next build` ok |

## 5. 정직 기록 — Owner 채널로 실발송 4건이 나갔다

검증 과정에서 alert 경로가 실전 상태였고, 아래 4건이 실제 Telegram 채널에 발송되었다
(전부 `ok:true`). 채널 e2e 검증으로는 소진되었고, 이후 검증은 전부 `--dry-run`으로 수행했다.

| 시각(UTC) | 내용 | 분류 |
| --- | --- | --- |
| 08:34:37 | hermesBridge CRITICAL (ledger.json 부재) | **오탐 → 재분류**(§6): staging 전 정상 상태는 WARN |
| 08:40:20 | app CRITICAL (프로세스 사망 감지) | **정상 동작** — 실제 사망을 실측 감지 |
| 08:40:28 | ordersPath·stockService CRITICAL | **오탐 → 구조 수정**(§6): readiness 게이트 신설로 재발 차단 |

## 6. 실측 중 발견해서 막은 것 (이 세션의 실질 산출)

환경에서 실제로 터진 4가지를 설계 수정으로 봉쇄했다 — 전부 재발 방지 구조가 코드에 있다.

1. **이중 supervisor 포트 쟁탈**: 백그라운드 종료 처리가 node 프로세스를 남겨
   supervisor 2개가 같은 포트에 각각 자식을 띄워, 진 서비스와 동시에 상대 자식이
   `code=1` 반복 사망 → crash-loop 오탐. → **PID lockfile**(`ops/supervisor.pid`)로
   이중 기동을 기동 시점에 거부.
2. **기동 지연의 장애 오판**: 앱이 뜨기 전 deep check가 돌아 orders/stock을 CRITICAL로
   승격(실발송 2건의 원인). → **readiness 게이트**: 첫 liveness 성립 전에는 실패 판정·
   deep check 자체를 보류.
3. **영구 웜업 구멍**: 포트는 점유했는데 500만 반복하는 서버가 게이트에 갇혀
   재시작·알림이 영원히 없는 사례 실측. → **웜업 한도 90초** 초과 시 기동 실패 판정·
   재기동 + alert.
4. **`.next` 프로덕션 빌드 오염(환경 지뢰)**: 같은 저장소 디렉토리에서의
   `next dev`(포트 3211 잔존)와 **동시 세션의 `next build`**가 실행 중인 prod 서버의
   청크를 갈아치워 BUILD_ID 소실·`MODULE_NOT_FOUND` 500 루프를 실측 발생시켰다.
   → dev 체계(3211)는 종료했고, spawn 전 `BUILD_ID` 사전 점검으로 원인이
   supervisor.log에 바로 보이게 했다. 근본 대책은 **RUNBOOK R-3/R-8**(재빌드 절차,
   동시 경쟁 금지)로 문서화 — supervisor가 임의로 빌드하지 않는 것은 의도이다
   (경쟁 중 재빌드는 오염을 키운다).

이 발견으로 slow readiness FAIL을 **연속 2회**부터 알리도록도 강화했다(외부 의존
일회성 블립이 채널로 가지 않게).

## 7. 재시작 시 상태의 정직한 운명

| 상태 | 재시작 후 | 근거 |
| --- | --- | --- |
| 주문 멱등키(2층) | **유지** — Orders 시트 컬럼이 단일 진실 | C 세션 §7 계약 |
| 재고 원장 | **유지** — `mission-20260909/N1_STOCK_BRIDGE/ledger.json`(디스크) | B 세션 |
| CS 대화 세션 | **초기화** — 인메모리(`globalThis.__csStore`) 설계대로. 클라이언트가 sid 404를 감지해 새 대화 시작 | CS handoff §1 |
| supervisor 이력 | 유지 — exits·재시작 수·쿨다운이 state.json 영속 | M 신설 |

## 8. 소유권 — 누구 파일을 만졌나

| 파일 | 상태 |
| --- | --- |
| `ops/**`(신설), `app/api/health/route.ts`(신설), 런북·본 보고서 | **M 신설 — 이번 커밋 전부** |
| 기존 세션 소유 파일(lib/, app/, components/, tests/) | **1행 미수정** |
| 워킹트리에 남은 타 세션 미커밋 변경(K 세션 타이포그래피 + **동시 진행 중인 에러정리 세션**) | 손대지 않음 — 그대로 유지 |

**동시 세션 주의(중요)**: 이번 세션 수행 중 이 저장소에서 **별도 작업 주체가
app/api 라우트를 실시간 편집 중**임을 확인했다(`lib/errorSanitize` 도입 라인).
M의 검증은 resilience 기계장치(프로세스/포트/로그/alert)에 대한 것이고, 동시 주체의
미완 코드 동작은 그 소유 세션의 검증 범위다. prod 서버와 세션 빌드가 같은 `.next`를
두고 경쟁하는 구조적 리스크는 RUNBOOK R-8에 정리했다.

## 9. 현재 운영 상태와 잔여 사항

- 감시 인스턴스 **가동 중**: port 3322, `--dry-run`(alert 로그 전용), 로그는 `ops/logs/`.
  중지: `taskkill /PID $(cat ops/supervisor.pid) /T /F` — RUNBOOK §1.
- 실채널 alert을 켜려면 `--dry-run` 없이 기동(RUNBOOK §1). 채널 수신 육안 재확인은
  `node ops/n1_supervisor.cjs --test-alert` 1회 발송.
- 잔여: ① 잔존 서버 정리 필요 — port **3323**(Session K prod), **3345**(미확인 prod)가
  read-only로 살아 있다(Owner 몫). ② `ledger.json`은 HERMES 최초 staging에서 생성될
  것 — 현재 WARN은 정상. ③ 동시 세션 종료 후 prod 전용 빌드 디렉토리 분리 검토(RUNBOOK R-8).

---
*Session M 완료 — TASK 30 · output 본 파일 + N1_HEALTH_RECOVERY_RUNBOOK.md · 이후 STOP.*
