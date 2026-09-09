# N1_SESSION_I_RETURNS_REPORT.md

> **SESSION I — N°1 RETURNS + INFO UX** · 2026-09-09
> 브랜치: **`n1-returns-info-ux`** (base = `wave2-base` = `646642b` — Session H 완료 상태의 WAVE2 기점)
> 범위: **TASKS 15–17** — PDP 교환·반품 문구 개선, 문의 위치 정정, 반품·교환 요청 플로우(회원/게스트).
> 결과: **테스트 171/171 PASS (I1–I7 신설 15 포함) · `tsc --noEmit` clean · `next build` ok ·
> 런타임 스모크 7항목 통과 · HERMES turn D — Return_Requests 계약 APPROVED + Ops 라우팅 REGISTERED.
> Orders 시트 write 0건(경계 실측) · 자동 refund 승인 경로 부재(테스트 잠금).**

---

## 0. 요약 — 무엇이 만들어졌나

1. **PDP 교환·반품 문구(TASK 15)** — 승인 정책 3문장을 그대로 문단 단위로 분리하고
   line-height 1.85 + 문단 간격을 적용했다. 문장 순서·표현·의미는 불변(정책 의미 변경 0).
2. **문의 위치 정정(TASK 15)** — "페이지 하단 **우측** 말풍선" → "**좌측**". 실제 고객센터
   위젯(`.cs-fab`)은 좌측 고정(장바구니 `.float-bar`가 우측 — x축 미러 구조)이라 기존 문구가
   실제 위치와 불일치했다. CSS 실측으로 검증 후 수정.
3. **반품·교환 요청 플로우(TASKS 16·17)** — 신규 `/orders` 페이지: 회원은 주문내역 → 주문 →
   요청, 게스트는 주문번호+연락처 완전일치 검증 조회 → 요청. 플로우는
   **상품 → 반품/교환 → 사유 → 메모 → 제출 → 접수 상태** 순서 그대로.
4. **상태 체계** — C의 `lib/orderState`(canTransition/readOrderStatus)를 유일한 근거로 재사용.
   신규 상태 체계 0건. 요청 가능 판정 = `canTransition(현재상태, "RETURN_REQUESTED")` 하나뿐.
5. **권한 경계** — 접수(Reception)는 app 소유 신규 시트 **Return_Requests**에만 기록.
   Orders 시트 write는 이 플로우에서 **0건** (HERMES/Ops authority). 자동 refund 승인 경로 부재.
   HERMES MASTER에게 turn D로 계약을 통지했고 **(1) APPROVED (2) Ops 라우팅 REGISTERED** 회신.

## 1. TASK 15 — PDP 교환·반품 문구 (줄바꿈/line-height 개선, 내용 불변)

**변경부**: `lib/display.ts` — `noticeQualityParagraphs()` 신설(승인 문구 3문장을 문단 배열로),
`noticeQualityText()`는 그 문단을 빈 줄로 연결하는 하위호환 형태로 유지(기존 소비자
`app/page.tsx` A/S 책임자 등은 무수정 동작).

| 항목 | 내용 |
| --- | --- |
| 문단 1 | 수령 후 7일 이내에 청약철회를 요청하실 수 있습니다. |
| 문단 2 | 이미 사용했거나 훼손된 상품은 청약철회 대상에서 제외됩니다. |
| 문단 3 | 전자상거래법상 소비자 청약철회 가능 범위를 준수합니다. |

- 표시: PDP(`app/product/[id]/page.tsx`)의 `<dd class="quality">`가 문단별 `<p>` 렌더 —
  `line-height: 1.85`(기존 dd 1.7 대비), 문단 간 `margin-top: 10px`(모바일 8px).
- **정책 의미 변경 금지 준수**: 세 문장은 승인 문구와 문자열 그대로 동일(I6에서 deepEqual
  검증). 시트가 새 문구를 내려주면 임의 분리 없이 그대로 통과(창작 금지 계약 유지).
- 문장 중간 강제 줄바꿈은 넣지 않았다 — 폭이 다른 화면에서 어색해지는 임의 break 대신,
  문장 단위 문단 + line-height로 가독성을 확보했다(태스크 예시의 핵심 의도).

## 2. TASK 15 — 문의 위치 "우측" → "좌측" (실제 위치 일치 검증)

**검증(정적 실측 + I6 테스트 잠금)**: `app/globals.css`에서
- `.cs-fab { position: fixed; left: max(16px, …); bottom: … }` — **하단 좌측 고정**
- 모바일 `@media (max-width: 640px) { .cs-fab { left: 16px; bottom: 14px; } }` — 좌측 유지
- `.float-bar`(장바구니+결제현황)는 `right:` 앵커 — 좌우 미러 구조가 설계 의도(주석 실존)

즉 고객센터 말풍선은 **하단 좌측**이 실제 위치이며 기존 안내 문구("우측")가 틀렸다.
`lib/display.ts` `AS_NEW`를 좌측으로 수정(구 카탈로그 fallback "문의하기 이용"도 동일
정규화 경유). 빌드 산물 전체에서 "하단 우측" 잔존 **0건**, "하단 좌측" 청크 5건 실측.

## 3. TASKS 16·17 — 반품·교환 요청 플로우

### 경로
- **회원**: `/orders` → 회원 주문내역(`GET /api/orders?token=` — Session C §9 재사용, 수정 0) →
  주문 선택 → 요청. 소유 검증: 세션 이메일 ↔ 주문 `고객이메일` 일치(대소문자 정규화).
- **게스트**: `/orders` → 주문번호+연락처 입력 → 검증 조회(`POST /api/orders/lookup` —
  Session C §10 재사용, 수정 0) → 요청. 연락처는 숫자 정규화 **완전 일치**
  (`verifyGuestOwnership` 재사용). 조회 폼의 연락처는 컴포넌트 상태에만 존재(저장소 기록 없음).
- **플로우 순서**: 상품 선택(주문 항목 내, 수량 상한=주문 수량) → 유형(반품/교환) →
  사유(유형별 목록 — CS 정책 안내와 정합) → 메모(선택, 500자) → 제출 → **접수 상태**
  (요청 목록 + 현재 주문 상태 라벨). 진입 링크: `/checkout/pending` 화면에 1개 추가.

### API (신규, `app/api/orders/return-request/route.ts`)
- `POST` — `{order_id, token|phone, type, reason_code, items[], note?}` → 검증 → Return_Requests
  1행 append + Ops 알림(CS 봇3 `N1_CS_BOT_TOKEN/N1_CS_CHAT_ID` 재사용, 실패 비차단).
- `GET ?order_id=&token|phone` — 소유 검증 후 그 주문의 접수 요청 목록 + 현재 주문 상태.
- 소유 불일치·미존재·인증 없음은 **구분 없는 generic 404**(PII 0 — lookup 계약 동일).
- 회원 토큰이 제시되면 회원 경로로만 판정(이메일 불일치 시 게스트 폴백 없음 — 타인 주문
  우회 차단).

### 순수 코어 (`lib/returnRequest.ts` — 의존성 주입 구조)
상태 판정·소유 검증·상품 검증·row 계약을 순수 함수/오케스트레이터로 분리, 라우트는 얇은
어댑터. 네트워크·시트 없이 전 경로 단위 테스트(I1–I5가 여기에 의존).

## 4. 상태 체계 — C 재사용, 접수/판정 분리, 자동 승인 금지

| 원칙 | 구현 |
| --- | --- |
| C 상태머신 재사용 | `canRequestReturnExchange(status)` = `canTransition(status, "RETURN_REQUESTED")` 위임. 전 상태 11개에 대해 orderState 위임 일치를 테스트가 검증(I4). 새 상태·새 전이 테이블 0건 |
| 요청 가능 상태 | C 테이블 그대로 **SHIPPED, DELIVERED**만. 운영자가 CS메모에 "반품요청" 태그를 남긴 주문은 `readOrderStatus`가 RETURN_REQUESTED로 판독 → 재요청 409 차단(I4) |
| 접수 vs 판정 분리 | app 기록은 Return_Requests `상태="접수됨"`뿐. 이후 승인·반려·환불은 Ops가 **Orders 시트**(CS메모 태그·결제상태 환불/환불완료)에 기록 → `readOrderStatus`가 자동 판독해 고객 화면에 상태로 반영. Session C 읽기 계약 무변경 |
| 자동 refund 승인 금지 | REFUND_PENDING/REFUNDED 전이를 만드는 코드 경로 부재. 접수 응답·row 상태에 환불 확정·승인 문구 없음을 테스트로 잠금(I5). 클라이언트 입력으로 주문 상태가 바뀌는 곳은 없다(C13 원칙 유지) |

## 5. HERMES — Orders write authority (turn D)

- **ZCode credential 직접 사용 0건**: 이 세션의 테스트는 전부 의존성 주입 fake(네트워크·시트·
  credential 접근 없음). 런타임 스모크는 거절/읽기 경로만. 시트를 만지는 스크립트 실행 없음.
- **app 런타임의 쓰기는 Return_Requests(app 소유, Customers 시트와 동일 취급)에 한정** —
  Orders 시트는 `findOrderById`(읽기)만 사용. I5가 "결제상태/배송상태/CS메모 컬럼 침범 없음"을
  명시 검증.
- **HERMES MASTER turn D**(`mission/hermes_turn_D_returns.txt` → `hermes_turn_D_reply.txt`):
  계약 통지 + 비준 요청 → 회신 **(1) APPROVED** (Return_Requests 12컬럼 계약·Orders write 0건·
  자동 승인 금지·PII 경계 승인 — HERMES가 브랜치를 READ-ONLY 실측하고 `node --test
  tests/returns.test.cjs` 15/15 PASS를 재실행해 확인) **(2) REGISTERED**
  (`N1_ORGANIZATION/ROUTING.md` OPERATIONS에 "반품·교환 요청 판정 → n1-ops-order" 행 추가,
  diff readback 확인 — 접수는 Return_Requests/CS 봇3 알림에서, 판정 기록은 Orders 시트 기존
  방식으로, side-effect 감사는 n1-qa).

## 6. 테스트 — I1–I7 (`node --test tests/returns.test.cjs`, 15 케이스 PASS)

| # | 시나리오 | 핵심 단언 |
| --- | --- | --- |
| I1 | member | 세션 이메일≡주문 이메일 → 접수 성공·Return_Requests 정확히 1행(회원 경로·상태 "접수됨"·주문상태 스냅샷 DELIVERED·메모 trim만) + 대소문자 정규화 일치 |
| I2 | guest | 주문번호+연락처 완전일치(하이픈 정규화) → 교환 접수 성공·게스트 경로 기록. 뒷자리 4자리 부분일치는 거절 |
| I3 | wrong ownership | 타 계정 토큰 / 불일치 연락처 / 미존재 / 인증 없음 → 전부 **동일 generic 404**(PII 0, 주문번호·이메일 유출 없음). 타 계정 토큰의 게스트 폴백 없음 |
| I4 | invalid status | SHIPPED/DELIVERED만 가능·나머지 전 상태 409. canRequestReturnExchange가 전 상태에서 orderState.canTransition과 1:1 위임 일치. 운영자 CS메모 "반품요청" 태그 판독→재요청 차단. 부적격은 접수 기록도 0건 |
| I5 | request persisted | append 1회·실패 시 정직한 500(성공 위장 금지). row 스키마 12컬럼 정합·**Orders 컬럼(결제상태/배송상태/CS메모) 침범 0**. 접수 상태="접수됨"·환불/승인 문구 부재(자동 승인 금지). 주문 외 상품·수량 초과·빈 선택·무효 사유 400 |
| I6 | PDP copy | 승인 3문장 deepEqual 보존(의미 변경 0)·구 시트 문구 매핑 유지·신규 시트 문구 통과. 문구 "하단 좌측" 포함·"우측" 잔존 없음. **CSS 실측**: `.cs-fab` fixed+left, 모바일 left:16px, `.float-bar` right(미러). PDP 문단 렌더·line-height 1.85·문단 간격 실존 |
| I7 | mobile | `/orders` 화면 640px media query(항목 row 스택·플로우 하단 네비·수량 컨트롤·게스트 폼 전폭) + PDP 모바일 문단 간격(8px) + 페이지/플로우 단계/진입 버튼/API 연결 소스 실측 |

전체 회귀: `node --test tests/*.test.cjs` → **171/171 PASS** (기존 156 + I 15).
`npx tsc --noEmit` clean · `next build` ok(`/orders` 7.14kB·`/api/orders/return-request` 라우트 포함).

## 7. 런타임 스모크 (:3323 prod, 실측 후 종료)

| # | 검증 | 결과 |
| --- | --- | --- |
| 1 | `GET /orders` | 200 · "주문 조회 · 반품/교환" SSR |
| 2 | `POST /api/orders/return-request` 빈 본문 | **400** `요청 유형(반품/교환)을 선택해 주세요` |
| 3 | POST 무인증·가짜 주문번호 | **404** generic(존재 유출 없음) — Orders 시트 읽기만 발생 |
| 4 | GET order_id 없음 | **400** `주문번호가 필요합니다` |
| 5 | GET 무인증 | **404** generic |
| 6 | `GET /product/PRD-N1-01` · `/checkout/pending` · `/` | 전부 200 (pending에 신규 링크 청크 포함) |
| 7 | `POST /api/orders/lookup` 빈 입력(C 회귀) | generic 404 — C 계약 무훼손 |

정직 경계: 스모크는 전부 거절/읽기 경로다. 실제 접수(Return_Requests 시트 생성·행 추가)와
Ops 알림 발송은 실행하지 않았다 — 최초 실접수는 운영(또는 Owner 승인 테스트 주문)에서
일어난다. 부작용: Return_Requests 시트는 아직 존재하지 않는다(첫 접수 시 app이 생성).

## 8. Mimosa 스캔 (커밋 훅 보완)

normal 깊이 스캔 완료: `scan-2026-09-09T04-41-09.854Z-7044b302f5fc`,
seal `sha256:98e303c…fed31`, findings 8 — 구성:
- SmartFitFlow.tsx 하드코딩 비밀값 후보 1, `recompute_pairs.py` 경로 후보 1 — **타 세션
  기존 항목**(Session H 리포트와 동일 목록).
- telegram SSRF 후보 6: 이 중 **Session I 신설 파일 1건**
  (`app/api/orders/return-request/route.ts:59` — env 토큰 → `lib/telegram.ts` 흐름).
  이 경로는 기존 C(`orders/route.ts`·`confirm/route.ts`)·D(`csRelay`·`telegramInbound`)와
  동일한 `sendTelegramMessage` 재사용이며, 해당 모듈은 고정 오리진
  `https://api.telegram.org` + 호스트 화이트리스트 검사로 SSRF 가드를 이미 갖춘다
  (`lib/telegram.ts:12-17` 실측). 신규 fetch·신규 URL 조립은 이 세션에서 만들지 않았다.
- 의존성: 오프라인 매칭 5패키지/34 advisory (context-only, H와 동일 — 온라인 재확인 필요).

본 보고서는 "프로젝트 전체 안전"을 주장하지 않는다 — 위 기존 항목의 실데이터플로 확인은
소유 세션·Owner 몫으로 남긴다.

## 9. 소유권 존중 — 누구 파일을 어디까지 만졌나

| 파일 | 소유 | I의 변경 |
| --- | --- | --- |
| `lib/returnRequest.ts` · `lib/returnRequestsSheet.ts` · `tests/returns.test.cjs` · `app/api/orders/return-request/route.ts` · `app/orders/page.tsx` · `components/OrderReturns.tsx` + `.module.css` | **I 신설** | 반품·교항 도메인 전체 |
| `lib/display.ts` | (표시 계층) | QUALITY 문단 분리·AS 좌측 정정 — 기존 계약(시트 원문 불변·새 문구 통과) 유지 |
| `app/product/[id]/page.tsx` · `product.module.css` | (디테일 경험) | 교환·반품 dd 문단 렌더 교체·quality 스타일 3줄 |
| `components/CheckoutFlow.tsx` | C | `/orders` 링크 1개(pending 화면 — H의 409 안내 1곳과 동일 최소 패치) |
| `lib/orderState.ts` · `lib/orderView.ts` · `lib/sheets.ts` · `/api/orders`(전 라우트) · auth core | C/A | **무수정** — import로만 재사용 |
| `lib/cs.ts`(CS 정책 문구) | D | **무수정** — 사유 목록만 정합하게 설계 |
| `.env.local` · credential | — | **무접촉** |

## 10. 잔여 사항 (이월)

1. Return_Requests 시트는 첫 실접수 시 생성된다 — HERMES는 이를 승인 완료(운영 라우팅
   등록 완료). 대량 운영 전 열 폭/정렬은 Ops 취향에 맞게 시트에서 조정 가능(헤더 계약 불변).
2. 요청 상태(GET)의 `requests[].status`는 Ops가 Return_Requests "상태" 열에 기록하면 그대로
   노출된다(현재 app은 "접수됨"만 기록). Ops 상태 어휘(검토중/승인/반려) 표준화는 차기 협의.
3. 취소(배송 전) 자가 요청 플로우는 이번 범위 외 — CANCEL_REQUESTED는 기존대로 고객센터
   경유(안내 문구가 이를 안내한다).
4. auth 세션 인메모리 한계(C §9)는 회원 조회·요청에 동일 적용 — 세션 만료 시 재로그인하면
   복구(주문 데이터는 시트에 영구).
5. 병합 게이트(차기): I 브랜치 통합 시 171 회귀 재실행 + wave2-base 태그 기점 확인.

---
*Session I 완료 — TASKS 15·16·17 · output 본 파일 · HERMES turn D APPROVED/REGISTERED · 이후 STOP.*
