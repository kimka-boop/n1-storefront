# N1_HEALTH_RECOVERY_RUNBOOK.md

> N°1 Storefront 런타임 감시·복구 운영 안내 (SESSION M · TASK 30 · RC0 기준 · 2026-09-09)
> 대상: `n1-storefront` 저장소, Windows/local launch architecture (변경 없음)
> 원칙: **새 infra 없음** — node .cjs supervisor 한 파일이 기존 `next start` 방식을 감시한다.

---

## 0. 한 장 요약

```bash
# 감시 시작 (채널 alert 포함) — 저장소 루트에서
node ops/n1_supervisor.cjs --port 3322

# 감시 시작 (alert 로그 전용 — 채널 미발송)
node ops/n1_supervisor.cjs --port 3322 --dry-run

# 상태 확인
curl -s http://127.0.0.1:3322/api/health        # 프로세스 liveness
node ops/n1_supervisor.cjs --once               # 6 경로 전체 점검 1회
cat ops/state.json                              # 재시작 이력·alert 쿨다운

# 중지
taskkill /PID $(cat ops/supervisor.pid) /T /F

# 채널 수신 확인 (1회 테스트 발송, 조치 불요)
node ops/n1_supervisor.cjs --test-alert
```

## 1. 구성

| 항목 | 값 |
| --- | --- |
| 감시 대상 | `next start -p 3322` 단일 프로세스 (Storefront + App/API 이중 표면) |
| 런처 | `ops/n1_supervisor.cjs` (plain node — PM2/서비스/Docker 없음) |
| fast liveness | 10초 — `GET /api/health` + `GET /` |
| slow readiness | 5분 — Orders 400 계약 · Stock `n1.stock.v1` 계약 · HERMES bridge · Telegram 구성 |
| 재시작 | 사망 → backoff 1s→30s → **포트 반납 확인 후** 재기동 |
| crash-loop | 10분 내 5회 → HOLD(5분마다 1회 재시도) + CRITICAL alert |
| hang | 프로세스 생존 + HTTP 연속 3회 실패(30초) → 트리 kill → 재기동 |
| 웜업 한도 | spawn 후 90초 내 readiness 미성립 → 기동 실패 판정 · 재기동 |
| alert | 기존 채널 재사용(`N1_CS_BOT_TOKEN`/`N1_CS_CHAT_ID`, `lib/telegram.ts`와 동일 경로) |
| spam 방지 | 컴포넌트 cooldown 30분 · 전역 시간당 5건 · 동일 상태 중복 억제(state.json 영속) |
| 로그 | `ops/logs/supervisor.log` · `app-stdout.log` · `app-stderr.log` (5MB × 3세대) |
| 상태 | `ops/state.json`(exit 이력·재시작 수·쿨다운), `ops/supervisor.pid`(단일 인스턴스 lock) |

## 2. Health/readiness 판정표

| 경로 | 방법 | 정상 | 비고 |
| --- | --- | --- | --- |
| App/API | `GET /api/health` | 200 `ok:true` | 외부 호출 0 — 헬스체크가 Sheets/쿼터를 소모하지 않는다 |
| Storefront | `GET /` | 200 | |
| Orders path | `POST /api/orders` `{}` | **400** | 시트 쓰기 없는 계약 프로브 |
| Stock service | `GET /api/stock?sku=PRD-N1-01` | 200 + `contractVersion n1.stock.v1` | 시트→ledger 미러→UNKNOWN 정직 폴백 포함 |
| HERMES path | bridge 디렉토리 + ledger 가독 | OK / WARN | **관찰 전용** — supervisor가 HERMES를 재시작하지 않는다 |
| Telegram path | env 구성 존재 | OK(configured) | 프로브 발송 없음 — alert 시에만 실전송 |

## 3. 장애 시나리오별 대응

### R-1 · 서비스 다운 (가장 흔함)
supervisor가 **자동 복구한다(실측 2초)** — 손댈 것 없음. 확인:
`tail -f ops/logs/supervisor.log` → `child exit → restart 예약 → port 반납 확인 — rebind → spawn`.

### R-2 · crash-loop HOLD ("재시작 HOLD" alert 수신)
빌드 손상·포트 경쟁·환경 고장으로 5회 연속 실패한 상태. **자동 재시작은 5분마다 1회만**
시도한다. 순서:
1. `tail -20 ops/logs/app-stderr.log` — 원인 확인
2. 원인 제거(대부분 R-3) 후 supervisor 재시작(HOLD 해제)

### R-3 · `production build 없음` / 500 루프 (`.next` 소실·손상)
**원인 거의 항상: 같은 디렉토리의 `next dev` 또는 다른 `next build`가 `.next`를 덮어씀.**
1. 동일 디렉토리의 dev 서버·빌드 프로세스 종료 확인:
   `wmic process where "name='node.exe'" get processid,commandline | findstr "n1-storefront"`
2. `npx next build`
3. supervisor 재시작 (또는 HOLD 대기 — spawn 시 BUILD_ID를 미리 점검해
   supervisor.log에 `production build 없음 … RUNBOOK §R-3`로 원인이 바로 찍힌다)
**금지**: 서비스가 떠 있는데 다른 세션이 `next build`/`next dev`를 같은 디렉토리에서
돌리는 것 — 실행 중 서버의 청크가 교체되어 500 루프가 된다(2026-09-09 실측).

### R-4 · "이미 supervisor가 구동 중" (exit 3)
단일 인스턴스 가드가 작동한 것. 기존 감시를 이어갈 거면 아무것도 하지 않는다.
교체하려면: `taskkill /PID $(cat ops/supervisor.pid) /T /F` → 재기동.

### R-5 · port 3322 점유 (exit 2)
`netstat -ano | findstr :3322` → 점유 PID 확인 → 잔존 서버면
`taskkill /PID <pid> /T /F`. **타 세션/타 저장소 서버(3300·3100 등)는 건드리지 않는다.**

### R-6 · Telegram alert이 안 옴 / 미구성
- `.env.local`에 `N1_CS_BOT_TOKEN`·`N1_CS_CHAT_ID` 존재 확인(값을 로그에 쓰지 않는다)
- `node ops/n1_supervisor.cjs --test-alert` — `ok:false`면 채널/토큰 문제(HERMES 주입 경로 확인)
- 스팸 방지에 걸린 경우: `ops/state.json`의 `alerts` 기록 확인 — cooldown 30분/
  시간당 5건/동일 상태 억제는 **정상 동작**이다. 억제 사유는 supervisor.log
  `alert 억제(…)` 라인으로 남는다.

### R-7 · HERMES 경로 WARN/FAIL
- `WARN(ledger 미생성 …)`: HERMES staging이 아직 없는 정상 상태 — 조치 불요.
  `cd mission-20260909 && node stock_watcher.cjs --status`로 원장 상태 확인.
- `WARN(inbound N건 정체)`: HERMES가 inbound 프로브 결과를 30분+ 미소비 — HERMES 측 확인.
- `FAIL(디렉토리 소실/ledger 파싱 실패)`: 구조 손상 — `inbound/outbound/escalations`
  디렉토리 재생성 또는 ledger 백업에서 복구. supervisor가 alert을 보낸다(연속 2회).

### R-8 · 동시 세션과의 경쟁 (환경 리스크 — 2026-09-09 실측)
이 저장소는 세션 단위로 같은 워크트리를 나눠 쓴다. **prod 감시 구동 중에 다른 세션이
같은 디렉토리에서 `next build`/`next dev`를 실행하면 서비스가 500 루프에 빠진다.**
- 짧은 스모크라면: 세션 종료 시 서버를 반드시 종료(기존 관용 "실측 후 종료" 준수)
- RC0 출시 이후: prod는 별도 배포 디렉토리(빌드 격리)로 이전 권장 — 코드 변경 없이
  `--port`와 cwd만으로 분리된다(감시 구조 동일).
- R-3의 재빌드 절차 전에 경쟁 주체 종료를 먼저 확인할 것.

### R-9 · 재시작 후 무엇이 남고 무엇이 초기화되나
| 유지 | 초기화(설계대로) |
| --- | --- |
| 주문 멱등성(Orders 시트 `멱등키` 2층) | CS 대화 세션(인메모리 — 클라이언트가 sid 404 감지 시 새 대화) |
| 재고 원장(bridge ledger.json, 디스크) | 인메모리 in-flight 멱등 병합(1층 — 시트 2층이 영구 방어) |
| supervisor 이력·쿨다운(state.json) | |

## 4. 검증 절차 (배포/점검 시)

```bash
node ops/n1_supervisor.cjs --selftest     # spam-guard 8/8 (네트워크 0)
node ops/n1_supervisor.cjs --once         # 6 경로 readiness — 전부 OK/WARN(configured) 기대
# crash 복구 훈련 (선택):
#   PID=$(curl -s http://127.0.0.1:3322/api/health | grep -o '"pid":[0-9]*' | cut -d: -f2)
#   taskkill /F /PID $PID   → supervisor.log에서 restart 체인, ~2초 내 200 복구
```

## 5. 시크릿 규칙

- 토큰·키 값은 env(`.env.local` — git 제외)에서만 읽는다. 로그·state.json·alert·
  `/api/health` 응답 어디에도 값은 기록되지 않는다(존재 boolean만).
- `/api/health`는 외부 의존을 호출하지 않는다 — 헬스체크 트래픽이 Sheets 쿼터나
  Telegram 채널을 소모하지 않는다.

---
*SESSION M · RUNBOOK 끝.*
