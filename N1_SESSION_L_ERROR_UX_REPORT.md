# N1_SESSION_L_ERROR_UX_REPORT.md

> **SESSION L — N°1 ERROR UX FAILURE MATRIX** · 2026-09-09
> 브랜치: **`n1-session-m-health-recovery`** (RC0 통합 상태 승계 — Session K 미커밋분을
> `65e6693`으로 선(先)커밋한 뒤 본 세션 작업분 `fbeb1e1`)
> 범위: **TASK 29** — 11개 도메인 failure matrix(loading / empty / failure / retry / user copy) 정비.
> **기능 추가 0건** — 필요한 error boundary·fallback·문구만 수정.
> 결과: **테스트 189/189 PASS (L1–L6 신설 6 포함) · `tsc --noEmit` clean · `next build` ok ·
> prod 런타임 HTTP 스모크 10항목 통과. 금지 토큰(500/undefined/null/stack/무한 spinner) 고객 노출 0건.**

---

## 0. 요약 — 무엇이 잘못되어 있었고 무엇을 잠갔나

조사 결과(전수 감사: 클라이언트 서피스 13개 + API 라우트 12개 + lib 12개), 고객이 실제로
볼 수 있는 결함은 4계통이었다.

1. **내부 예외 원문 유출** — 8개 API 라우트의 catch가 `e.message`를 그대로 응답했다.
   Google Sheets/Drive API 오류, OAuth 토큰 응답 본문, 파일 경로(ENOENT)가 고객 화면에
   도달할 수 있었다 (`500`, 내부 오류문 = 금지 토큰의 실제 노출 경로).
2. **진실성 위반(성공 문구를 실패에 표시)** — 대표 3건:
   CS 상담원 전환에서 Telegram 전송이 실패해도 "대화 내용은 상담원에게 함께 전달됩니다" 표시,
   PDP에서 네트워크 실패를 "상품을 찾을 수 없습니다"로 위장, 클립보드 복사 실패를 "✓ 복사됨"으로 표시.
3. **거짓 빈 상태 / 유령 상태** — 홈 로딩 중 "이번 컬렉션에는 상품이 없습니다" 표시,
   pending 주문 없이 결제 화면 직접 진입 시 ₩0·"-" 입금 화면 렌더.
4. **무한 대기 / 영구 정지** — 홈 오류 배너가 폴링 복구 후에도 영구 잔존,
   회원 주문내역 오류 래치로 재조회 불가, Sheets 무응답 시 라우트 전체가 매달림(무한 spinner 원인).

추가로 **런타임 스모크에서 P0 1건을 발견·복구**했다:
`/api/auth`가 google-spreadsheet v5에 없는 메서드(`setHeaderValues`)를 호출해
**가입·로그인·프로필 readback 전체가 런타임 실패**하고 있었다 (§4).

---

## 1. Failure Matrix — 11개 도메인 × 5상태 (수정 후 기준)

| 도메인 | loading | empty | failure | retry | user copy (고객 문구 원칙) |
| --- | --- | --- | --- | --- | --- |
| **Products API** | 홈 "불러오는 중" 신설 — 로딩과 빈 컬렉션 구분 | 검색/컬렉션 빈 문구(로드 완료 후에만) | 고정 문구 + 502 + **다시 시도 버튼**(신설), 30s 폴링 복구 시 배너 자동 정리(신설) | 버튼 + 자동 폴링 | "지금 상품 목록을 불러오지 못했어요 — 잠시 후 다시 시도해 주세요" |
| **Sheets** | getDoc **12s 타임아웃 race**(신설) — 무응답이 곧 무한 로딩이 되지 않는다 | 빈 시트 = 빈 배열(정상 응답) | 라우트별 502 고정 문구(원문은 서버 로그만), stock은 `stagedReadable:false`로 열화 명시 | 모든 라우트가 즉시 실패를 반환 | 도메인별 "지금 ~를 확인하지 못했어요" |
| **Auth** | 위젯 "확인 중..."(finally 해제, 기존) | — | GET try/catch(신설, 크래시→502), 401 만료와 502 실패 구분, 가입/로그인 fallback 문구(신설) | 버튼 재활성(finally) | 만료: "세션 만료" / 실패: "지금 계정 정보를 확인하지 못했어요" |
| **Smart Fit** | "확인 중..." + disabled(finally, 기존) | — | 서버 위생 문구 + 클라이언트 fallback | 버튼 재활성 | confirm "계정에 저장됐어요"는 **서버 저장 성공(ok) 후에만** 출력 — 실패 시 미출력 (검증 §3-4) |
| **Stock** | PDP 조회 중 상태(기존) | 미스테이징 = UNKNOWN 뷰(숫자 창작 없음, 기존 계약) | lookup 실패 전용 truthful note + 구매 CTA 열화(기존 H), 라우트 try/catch 502(신설) | 새로고침 안내·409 후 재제출 | "재고 정보를 불러오지 못했습니다" ≠ "품절" (구분 유지) |
| **Cart** | hydration 게이팅(기존) | "장바구니가 비어 있습니다"(기존) | corrupt localStorage 파싱 방어(기존) — 네트워크 없음 | — | — |
| **Orders** | "처리 중..."(finally, 기존) | 체크아웃 빈 카트 문구(기존) | 409 재고 게이트 truthful 유지, 나머지 502 고정 문구(신설), **₩0 유령 결제 화면 차단**(신설) | 버튼 재활성 + 멱등키 재사용(기존 C) | 409: 서버 게이트 문구 + "장바구니는 그대로 유지됩니다" |
| **HERMES(ops)** | — | — | ops 알림 실패 = console 기록, **고객 응답은 주문 접수 사실만** (알림 성공을 단정하지 않는 문구 유지) | Return_Requests 재제출 | "주문이 접수되었습니다"(접수=사실), "확인이 완료되면 전환됩니다"(미래형, 기존) |
| **Telegram** | — | — | **전달 실패 시 완료형 문구 금지**(신설, §2) — 후속 메시지 재전달 훅(기존) 유지 | 고객 다음 메시지가 재전달 트리거 | 성공: "대화 내용은 상담원에게 함께 전달됩니다" / 실패: "전달이 지연되고 있어요 — 메시지를 한 번 더 보내주시면 다시 전달을 시도합니다" |
| **payment** | "처리 중..."(기존) | **pending 없는 직접 진입 = "진행 중인 결제가 없습니다"**(신설) | 확인 요청 실패 시 상태 미전환 + truthful 문구(기존 I/C) · 계좌 복사 성공/실패 실측 표시(신설) | 확인 요청 재클릭 | 무통장 V1: "입금 대기"만 표시 — PG 없음을 `unavailableReason`으로 고지(기존) |
| **email/media** | — | 이미지 부재 = 조용한 열화 | email: EMAIL_VERIFY_DEFERRED 정직 스텁(기존 A) · lookbook 2개 라우트 크래시 차단 + Drive/토큰 오류본문 유출 제거(신설) | — | 이메일 인증은 "지연 계약"으로만 안내 — 발송 사칭 없음 |

---

## 2. CS 상담원 전환 — "전달" 진실성 (핵심 수정)

**변경 전**(`lib/csEngine.ts escalateSession`): 상태를 HUMAN_PENDING으로 바꾸고
`ESCALATION_NOTICE`("…대화 내용은 상담원에게 함께 전달됩니다")를 먼저 기록·반환한 뒤
Telegram 전송을 시도 — **전송 실패 여부와 무관하게 전달 완료형 문구가 고객에게 표시**됐다.
위젯은 escalated 응답에서 전사본을 다시 당겨와 system 메시지를 그대로 렌더하므로,
거짓 문구가 실제 고객 화면에 나갔다.

**변경 후**: 전송 결과를 먼저 확인하고, 그 결과에 맞는 문구만 기록·반환한다.

```ts
const sent = await sendEscalationTranscript(session, reason);
const notice = customNotice || (sent ? ESCALATION_NOTICE : ESCALATION_DELIVERY_PENDING_NOTICE);
appendSystemMessage(session, notice);
```

- 신설 `ESCALATION_DELIVERY_PENDING_NOTICE`(lib/cs.ts):
  "전문 상담원 연결을 요청했어요. 지금 상담원 전달이 지연되고 있어요 — 잠시 후 메시지를
  한 번 더 보내주시면 바로 다시 전달을 시도합니다."
- 접수 상태(HUMAN_PENDING)와 재시도 훅(고객 다음 메시지 → `notifyOperatorNewCustomerMessage`
  재전달)은 그대로 유지 — §45 중복 escalation 금지·미션 §47 재시도 훅 계약 준수.
- customNotice 경로(주문 조회 실패 → `LOOKUP_FAILURE_NOTICE`)는 기존 테스트 잠금
  (`assert.equal(r.reply, cs.LOOKUP_FAILURE_NOTICE)`)과 의미상 정직("요청하겠습니다" —
  요청 접수는 사실)을 모두 만족하도록 그대로 통과시킨다.
- **L2/L3 테스트로 잠금**: 토큰 부재(전송 실패) 시 `reply`에 '전달됩니다'·'연결 완료'
  포함 금지 + system 기록도 동일 정직 문구 / 전송 성공(fetch stub) 시에만 `ESCALATION_NOTICE`.

---

## 3. 내부 정보 유출 차단 — `lib/errorSanitize.ts` (신설)

8개 라우트의 catch가 `NextResponse.json({ ok:false, error: e.message })` 패턴이었다.
Google API 오류문·시트 ID·토큰 엔드포인트 응답 본문·ENOENT 파일 경로가 그대로 고객 응답이 될 수 있었다.

```ts
export function clientSafeFailure(e: unknown): { status: number; message: string }
```

- **계약 오류(라우트가 의도적으로 던진 4xx 한국어 문구)만 통과** — 재고 409, 필수항목 400,
  "주문 없음" 404 등은 이미 고객용으로 작성된 정직 문구다.
- 그 외(예상 못한 예외·업스트림 실패)는 **502 + `GENERIC_UPSTREAM_MESSAGE`**
  ("일시적인 접속 문제가 발생했어요 — 잠시 후 다시 시도해 주세요")로 치환.
- `logInternal(scope, e)` — 원문은 서버 로그에만. 고객 응답 본문에는 절대 미포함.

| 라우트 | 변경 전 | 변경 후 |
| --- | --- | --- |
| `/api/products` | 500 + raw e.message | 502 + 고정 문구 |
| `/api/orders` POST/GET | `e.status\|\|500` + raw message | 계약(400/404/409)만 통과, 나머지 502 |
| `/api/orders/confirm` | 동일 | 동일 (+ "Orders 시트 없음" 문구 제거) |
| `/api/orders/lookup` | 500 raw — **generic-404 디사이플린 붕괴** | 502 "지금 주문 조회가 되지 않아요" — 조회 불가와 없음을 구분 |
| `/api/orders/return-request` POST/GET | 500 raw ×2 | 계약 통과 + 502 |
| `/api/chat` | 500 raw(JSON 파서 오류 포함) | 502 고정 문구 |
| `/api/lookbook-files` | Drive 오류 본문 200자·토큰 갱신 실패 본문·파일 경로 노출 | 전부 로그로만, 502 고정 문구 |
| `/api/stock`·`/api/cs`·`/api/telegram/poll`·`/api/lookbook/[pid]`·`/api/auth` GET | **try/catch 부재 — 핸들러 크래시 = Next 기본 500** | 전부 계약 형태(`ok:false`)로 응답 |

- `L4` 소스 잠금 테스트: app/api 전체 route.ts를 순회해 `e instanceof Error ? e.message` /
  `error: message` / `.stack` 패턴이 **고객 응답 경로(console.* 행 제외)**에 존재하지 않음을 잠금.
- `L5`: 내부 저장소명("Orders 시트 없음")이 throw 문구에 남지 않음을 잠금.

---

## 4. 런타임 스모크에서 발견한 P0 — `/api/auth` 전면 실패 복구

prod 기동(`next start`) 후 스모크에서 **모든 `/api/auth` 요청이 실패**했다
(세션 시작 전에는 크래시 → Next 기본 500이었고, 본 세션의 GET 래핑 후 502로 관측).

```
[api/auth] TypeError: r.setHeaderValues is not a function
```

- 원인: `app/api/auth/route.ts getUsersSheet()`가 Users 탭에 Session A 확장 컬럼을
  덧붙일 때 **google-spreadsheet v4 API명 `setHeaderValues`**를 호출 — v5.3.0에는
  `setHeaderRow`만 존재(d.ts 실증). 라이브 Users 탭이 확장 컬럼 부재 상태이므로
  마이그레이션 경로가 매 요청마다 TypeError → ensureStore 실패 → 가입·로그인·readback 전면 실패.
- 수정: **1줄** — `setHeaderRow([...hv, ...missing])` (의도·주석 불변).
- 세션 경계: Session A(auth foundation) 소유 파일이나, J 선례(통합 과정에서 발견된
  타 세션 결함 수정)에 따라 복구했다. 세션 A 리포트 보완 대상으로 기록한다.
- 복구 후 스모크: `GET /api/auth?token=bogus` → **401 "세션 만료"**(정상 계약),
  `check-username` → **200 ok:true**.

---

## 5. 클라이언트 서피스 수정 상세

| 서피스 | 결함 | 수정 |
| --- | --- | --- |
| 홈 `app/page.tsx` | 로딩 중 거짓 "상품이 없습니다" / `data.error` 원문 렌더 / 복구해도 배너 영구 잔존 / 재시도 수단 없음 | `productsLoaded` 게이팅으로 loading↔empty 분리, 고정 문구 + **다시 시도 버튼**(globals.css `.error-retry` 신설), 성공 시 `setError("")` |
| PDP `app/product/[id]/page.tsx` | fetch 실패·`ok:false`를 "상품을 찾을 수 없습니다"로 위장 | state에 `"error"` 신설 + **다시 시도 버튼**(`.retryBtn` 신설) + 홈 링크 — notfound는 카탈로그에 실제 없을 때만 |
| CheckoutFlow | pending 없는 직접 진입 시 ₩0·"-" 유령 결제/확인 화면, 복사 실패도 "✓ 복사됨" | 두 스테이지에 **"진행 중인 결제가 없습니다"** 가드(신설), clipboard await 결과 기반 `✓ 복사됨`/`복사 실패` |
| CsWidget | 전송 실패 시 입력 소실(재입력 강요), 서버 500 원문이 ok:false로만 흡수됨은 기존대로 안전 | 실패 시 **입력 보존**(재전송=재시도) — 실패 안내 문구는 기존 truthful 문구 유지 |
| AuthNav | 닫힌 모달에 늦게 도착한 응답이 유령 성공 화면(confirmMsg)을 남김, `data.error` fallback 부재 | 열기/전환 핸들러 전반에 `setConfirmMsg(null)`, fallback 문구 추가 |
| OrderReturns | 회원 내역 오류가 **영구 래치**(재조회 불가·재시도 수단 없음), 401 만료와 실패 구분 없음, raw error 렌더 | `memberRetryTick` 재조회 + **다시 시도 버튼**, 401=만료 안내 / 기타=일시적 문제 안내, 서버 문구 비의존 고정 문구 |
| FloatingOrderTracker | 저장본 무검증(₩0 유령 팝업 가능), 복사 피드백 0 | CheckoutFlow와 동일 기준 검증 + 제거 시 팝업 정리, 복사 성공/실패 표시 |
| useUsernameCheck | "사용할 수 있는 아이디예요"가 확인 중에 잔존 | checking 진입 시 메시지 클리어 |

---

## 6. 금지 토큰 검증 (고객 노출 경계 기준)

| 금지 항목 | 검증 방법 | 결과 |
| --- | --- | --- |
| `500` / 내부 오류문 | 전 API `error:` 리터럴 전수 열람 + L1 고정문구 토큰 검사 + L4/L5 소스 잠금 | **0건** — 모든 실패 응답이 한국어 고정 문구 또는 의도된 계약 문구 |
| `undefined` / `null` | 클라이언트 JSX 전수 grep | **0건** (하드코딩·렌더 모두) |
| stack trace | `.stack` 소스 잠금(L4) + grep | **0건** |
| 무한 spinner | 모든 busy/typing이 `finally` 해제 + getDoc 12s 타임아웃으로 서버 무응답 대기 차단 + 라우트 전체 try/catch | **해당 경로 제거** |
| "상담원 연결 완료" 오표시 | L2 잠금(전송 실패 시 완료형 문구 금지) | **잠금** |
| "주문 완료" 오표시 | 주문 성공 문구는 `data.ok` 게이트만(기존), confirm 실패는 상태 미전환(기존) + ₩0 유령 화면 제거 | **유지·보강** |

---

## 7. 검증

1. **테스트**: `node --test tests/*.test.cjs` — **189/189 PASS**
   (기존 183 유지 — 기존 문자열 잠금·계약 테스트 무손상 — + 신설 `tests/errorUx.test.cjs` L1–L6).
   - L1 위생 계층(계약 4xx 통과 / 예외→502 고정문구 / 금지토큰 미포함)
   - L2 전송 실패 escalation 정직성 / L3 전송 성공 escalation(fetch stub, 메시지 매핑 검증)
   - L4 raw 유출 소스 잠금(12개 라우트 순회) / L5 내부 저장소명 소스 잠금
2. **타입/빌드**: `tsc --noEmit` clean · `next build` ok (27 routes 정상 생성).
3. **런타임 스모크(prod, :3211)**: 홈 200 · products 실시간 200(ok:true) · stock 계약 200
   (`stagedReadable:false` 정직 표시) · auth GET bogus→**401** · check-username→**200** ·
   cs bogus sid→404 · chat 빈 메시지→400 · lookup 불일치→**uniform 404** —
   계약 밖 크래시 0건.

---

## 8. 경계 — 이번에 하지 않은 것 (기록)

- **기능 추가 0건**: 재시도 큐·오프라인 재전송· Sheets 캐싱 등은 신설하지 않았다.
  retry는 "버튼/재제출/다음 메시지" 형태의 기존 아키텍처 내 해결만.
- **HERMES ops 알림 실패의 고객 응답 반영**: 알림 실패를 고객에게 알리지 않는 것은
  기존 계약대로(고객 주문 접수는 사실이므로) 유지. 알림 실패는 서버 로그로만 남긴다.
  (운영자 무통지 상태가 지속되는 운영 리스크는 HERMES/인프라 세션 인계 사항)
- **`/api/telegram/poll`의 `last_error` 진단 노출**: 고객 UI가 아닌 운영 진단 엔드포인트로
  기존 소비자(QA 프록시·감사)가 있어 응답 형태를 유지하고, 크래시 차단만 적용했다.
- **`/api/auth`의 `getDoc` 중복 구현**(lib/sheets 미재사용): 동작 복구(§4)까지 수행했으나
  통합 리팩터는 본 세션 범위 밖 — auth 세션의 후속 정비 권장.
- **Session M 병렬 작분 미포함**: `app/api/health/`(TASK 30)·관련 파일은 본 세션이
  커밋하지 않았다 (M 세션 귀속 유지).

---

*세션 L 종료. RC0 failure matrix의 11개 도메인에서 "실제 상태와 일치하는 고객 문구"가
테스트로 잠겼다 — 다음 세션은 이 잠금 위에서 진행할 것.*
