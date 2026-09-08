# N1_SESSION_C_COMMERCE_CORE_REPORT.md

**SESSION C — N°1 Commerce Core (Tasks 18–23)**
2026-09-09 · 브랜치 `n1-storefront-integrated-v1` · 소유: CART / BUY NOW / CHECKOUT / ORDER

---

## 0. 요약

기존 commerce(Cart·CheckoutFlow·Orders API·purchaseState)는 **전부 재사용**했고, 재작성한 것은 없다.
이번 세션의 실제 작업은 (1) 있던 계약을 실제 플로우에 **연결**한 것(Cart guest→member 병합,
멱등키 전송)과 (2) 없던 **서버 계약을 추가**한 것(주문 상태 머신, 멱등성 2층 방어, 회원 주문내역,
게스트 조회, 공급사 재고 경계)이다.

- 테스트: **88/88 통과** (기존 74 + 신규 C1–C13 커버 14)
- 타입: 신규·수정 파일 전부 clean (`tsc --noEmit` — 단, Session B 진행 중 파일 `lib/stock/normalize.ts`에
  B 소유 에러 2건 존재. 무접촉, B가 정리할 것)
- 런타임 스모크: `/checkout` 200, `GET /api/orders` 무토큰 401, `POST /api/orders/lookup` 빈입력
  generic 404, `POST /api/orders` 필수값 누락 400 — 전부 기대대로

---

## 1. 재사용한 기존 commerce (§1 — 재작성 금지 준수)

| 기존 자산 | 위치 | 상태 |
| --- | --- | --- |
| Cart 순수 로직 | `lib/cart.ts` | 재사용 + persistence 계약 추가(§2) |
| 카트 컨텍스트 | `components/CartProvider.tsx` | 재사용 + 신원 전환 연결(§2) |
| 카트 드로어 | `components/CartDrawer.tsx` | **무수정** (이미 image/raw option/qty/subtotal/remove 완비) |
| Buy Now stash | `lib/checkout.ts` | **무수정** (sessionStorage 1개 선택 격리 — 검증만 추가) |
| Checkout 플로우 | `components/CheckoutFlow.tsx` | 재사용 + 멱등키 전송만 추가(§4) |
| 결제수단 경계 | `lib/payments.ts` | **무수정** (bank_transfer 유일 활성, PG 비활성+사유) |
| 주문 API | `app/api/orders/route.ts` | 재사용 + 멱등키/GET 추가(§3) |
| 입금확인 API | `app/api/orders/confirm/route.ts` | 재사용 + 중복 제거(§3) |
| Price Authority | `/api/orders` 2단계 서버 재계산 | 기존 그대로 — 클라이언트 금액·상품가 신뢰 금지 유지 |
| Sheets 계층 | `lib/sheets.ts` | 재사용 + 조회 함수 3개 추가(§3) |

`purchaseState`(`lib/experience.ts`: PDP 구매 버튼 상태 ready/choose/soldout/unconfirmed)는
기존 그대로이며 PDP `handleBuyNow`가 raw 옵션을 stash로 넘기는 구조도 유지했다.

---

## 2. CART — guest/member 공용 + persistence contract (§2)

### 이번에 연결한 것
`mergeCarts()` 순수 계약은 있었지만 **로그인 플로우에 연결돼 있지 않았다.** CartProvider가
AuthProvider의 token/email 변화를 관찰해(→ auth core 무수정) 신원별 카트를 전환한다.

### Cart persistence contract (Session H 이후 서버 카트 도입 시에도 동일 계약 사용)
```
활성(게스트) 키   localStorage "n1_cart_v1"            — 기존 키 그대로 (하위호환)
회원 키           localStorage "n1_cart_v1_m_<정규화 email>"  — memberCartKey(email)
로그인  시퀀스    ① 현재 게스트 카트를 게스트 키에 '보존'(파괴 금지)
                 ② merged = mergeCarts(회원카트, 게스트카트)   — 동일 라인 수량 합산(상한 10),
                                                            스냅샷은 더 이른 added_at 승리
                 ③ 회원 키에 저장 + 활성 전환
로그아웃 시퀀스   회원 카트는 회원 키에 유지, 게스트 보존본으로 복귀 → 재로그인 시 ② 재적용
```
- 라인 식별은 raw `sku::color::size` (표시 라벨 무관), 게스트 카트는 어떤 경우에도 유실되지 않는다.
- AuthProvider / `/api/auth` 는 **한 줄도 수정하지 않았다** (전역 `__userStore` 는 orders GET에서 읽기만 사용).

---

## 3. ORDER API — 멱등성 + 회원내역 + 게스트 조회

### POST /api/orders (주문 생성 — 멱등 §7·§8)
- 요청에 `idempotency_key` 추가(선택 — 레거시 클라이언트 호환 유지).
- **2층 방어**:
  1. `lib/idempotency.ts withIdempotency()` — 동일 키 동시/재도착 요청을 한 Promise로 수렴
     (시트 검사↔삽입 사이 race 차단). 실패는 캐시하지 않아 재시도 가능, 성공은 24h replay.
  2. Orders 시트 **`멱등키` 컬럼**(`lib/sheets.ensureOrdersIdempotencyColumn` 자동 append) 조회 —
     이미 인입된 키면 재고 재차감·중복 인입·중복 알림 없이 원본 응답 replay (`duplicate: true`).
     인스턴스가 달라도 시트가 단일 진실.
- 응답에 canonical 상태 추가: `status: "PAYMENT_PENDING"`, `status_label: "입금 대기"` (additive).
- 기존 계약 유지: 서버 가격 재계산(Price Authority), 옵션별재고 확인, 분리배송 판별, 봇2 알림.

### POST /api/orders/confirm (입금확인 요청 — callback retry §9)
- `withIdempotency("orders.confirm", orderId)` + CS메모 중복 판정
  (`confirmMemoAlreadyRequested`) → 같은 주문의 재도착은 메모·알림 **1회만** 기록 (`duplicate: true`).
- 운영자가 이미 결제완료 이상으로 처리한 주문에는 새 요청을 남기지 않는다.
- 클라이언트 요청만으로 결제상태가 바뀌는 것은 여전히 불가능 (V1 원칙 유지).

### GET /api/orders?token= (회원 주문내역 §9 — 신규)
- auth 세션 저장소(`global.__userStore.sessions`)를 **읽기만** 해서 이메일 확인 →
  `고객이메일` 일치 주문만(최신순, 상한 50) `projectOrderForOwner` projection으로 반환.
- 본인 주문만 조회. 토큰 없음/무효 → 401.

### POST /api/orders/lookup (게스트 조회 §10 — 신규)
- `{ order_id, phone }` — 연락처 숫자 정규화 **완전 일치**만 통과 (`verifyGuestOwnership`).
- 주문번호만 있는 요청은 PII 0인 generic 404 — 미존재와 불일치를 구분하지 않아
  주문번호 존재 자체도 유출하지 않는다 (`publicOrderProbeRejected`).
- CS 상담용 뒷자리 4자리 검증(사람 개입 플로우)과 분리 — 자가 조회는 전체 일치만 허용.

---

## 4. CHECKOUT / BUY NOW / 결제 UI (§3·§4·§5)

- **Buy Now 격리(C3)**: PDP `stashBuyNow(현재 선택 1개)` → CheckoutFlow가 stash를 카트보다
  우선 사용, 카트의 다른 상품은 절대 포함되지 않음. 카트 경로 진입 시(CartDrawer) stash를
  clear해 소스 가로챔 방지 — 기존 구현이 이미 정확하여 무수정, 테스트로 잠금(C3).
- **Checkout 구조(C4)**: ①상품 확인 ②주문자/배송 ③결제 수단 ④최종 검토 4단계 유지.
  이번 추가는 ④의 주문 생성 POST에 **멱등키**를 실은 것뿐:
  - `sessionStorage "n1_checkout_idem"` — 같은 제출 의도(더블 클릭/실패 재시도)는 동일 키 재사용,
    성공 시 소비. 새로운 주문 의도는 새 키.
- **계좌이체(C5·C6)**: `lib/payments.ts`의 provider abstraction 유지 — `PAYMENT_METHODS[]`에서
  `bank_transfer`만 `available: true`, `pg_card`는 "결제 시스템 연결 준비 중" 비활성(사유 표시).
  PG 연동 시 배열에 수단 추가 + `N1_PG_INTEGRATION_HANDOFF.md`의 교체 지점 그대로 사용.
- **C13 fake-paid 부재**: PAID로 갈 수 있는 경로는 (a) 운영자가 시트 결제상태를 갱신하거나
  (b) PG 검증 성공 후 서버 confirm — 클라이언트 전송값이 상태를 결정하는 곳이 없다.

---

## 5. ORDER STATE MACHINE (§6) — `lib/orderState.ts` (신규)

### Canonical 상태 집합
```
DRAFT → PAYMENT_PENDING → PAID → PREPARING → SHIPPED → DELIVERED
                 ↘ CANCEL_REQUESTED → CANCELLED (종단)
PAID/PREPARING → CANCEL_REQUESTED → CANCELLED | 반려복귀(PAID/PREPARING)
SHIPPED/DELIVERED → RETURN_REQUESTED → REFUND_PENDING → REFUNDED (종단)
                                  ↘ 반려복귀(DELIVERED)
```
- `canTransition / assertTransition / isTerminalStatus / displayLabel` export.
- **Session I 재사용 계약**: 반품 플로우는 `DELIVERED → RETURN_REQUESTED → REFUND_PENDING →
  REFUNDED` 전이 + `readOrderStatus()` 판독만 import 하면 된다. 시트 컬럼 구조 변경 없음.

### 기존 상태와 harmonize (운영자 흐름 보존)
- 시트는 기존대로 `결제상태`(입금대기/입금확인중/결제완료/결제취소/환불…) +
  `배송상태`(접수/출고준비/배송중/배송완료) 2열 유지.
- `toCanonicalStatus({paymentStatus, shipStatus})` — 레거시 2열 → canonical 1개 읽기.
  우선순위: 취소/반품/환불 키워드 > 결제 미완료(=PAYMENT_PENDING) > 결제완료(배송단계 세분화).
- `readOrderStatus({paymentStatus, shipStatus, csMemo})` — CS메모의 `반품요청/취소요청` 태그까지
  반영해 요청 상태를 판독(종결 상태가 우선). Session I가 그대로 재사용.

---

## 6. STOCK INTEGRATION BOUNDARY (§11) — `lib/supplierStock.ts` (신규, 인터페이스만)

- `finalStockCheck(lines)` — 주문 확정 전 마지막 재고 확인의 단일 진입점.
- `StockAdapter` 인터페이스(`checkAvailability`/선택적 `reserve`) + `registerStockAdapter()` 주입점.
- 기본 `noopSupplierStockAdapter`는 **정직한 미확정**(`ok: null, definitive: false`)만 반환 —
  재고를 날조하지 않는다. 호출자는 `definitive:false`면 기존 시트 옵션별재고 검증으로 폴백.
- **배치**: Session B가 작업 중인 `lib/stock/` 네임스페이스와 겹치지 않게 `lib/supplierStock.ts`로
  분리했다. **Session B 파일(`lib/stock/*`, mission-20260909/*)은 전혀 건드리지 않았다.**
- 실제 공급사 백엔드 = Session B, Checkout 연결 = Session H:
  Session H는 `/api/orders` 재고 확인 단계 앞에서 `finalStockCheck()`를 물리고
  `definitive:true`일 때만 hard-stop 하는 형태로 연결하면 된다.

---

## 7. 테스트 (§12) — `tests/commerce.test.cjs` (신규 14건)

| CASE | 검증 | 결과 |
| --- | --- | --- |
| C1 | 게스트 카트 담기/소계/삭제/수량 + 게스트 키 하위호환 | ✅ |
| C2 | 회원 키 파생(이메일 정규화) + merge 계약·게스트 보존·재적용 멱등 | ✅ |
| C3 | Buy Now stash 1개 격리 — 카트 미포함·미약탈, 카트 경로 stash clear | ✅ |
| C4 | 다품목 소계/배송비 경계(5만원)/총액 + 서버 payload는 sku·color·size·qty만 | ✅ |
| C5 | raw 옵션(겨자/95) 직렬화·병합 보존, 표시만 변환, raw 기준 라인 분리 | ✅ |
| C6 | 계좌이체 유일 활성 + PG 비활성 사유 표시 | ✅ |
| C7 | 필수 상태 11개·정상/불법 전이·종단·assert throw + 레거시 harmonize + CS메모 요청 판독 | ✅ |
| C8 | 동일 멱등키 동시 3요청 → 1회 실행·replay, 타 키 독립, 실패 후 재실행 | ✅ |
| C9 | confirm 재도착 1회 수렴 + 메모 중복 판정 + 결제완료 주문 재요청 대상 아님 | ✅ |
| C10 | 소유자 projection(주문번호/일시/항목/금액/결제/배송/상태) + 손상 JSON corrupt 플래그 | ✅ |
| C11 | 연락처 완전 일치만 통과(뒷자리 부분 일치 실패) + 번호만 probe는 PII 0 | ✅ |
| C12 | 소유 불일치 → generic 응답(주문번호/고객명 유출 없음) | ✅ |
| C13 | fake paid 경로 부재 + 생성 상태는 PAYMENT_PENDING 하나 + 재고 어댑터 미확정 정직성 | ✅ |

회귀: 기존 `cart.test.cjs` 포함 전체 **88/88 통과**. 런타임 스모크(§0)도 통과.

---

## 8. Session H / I / J 인계 — 인터페이스 요약

### Session H (Checkout 연결)
```
finalStockCheck(lines: StockCheckLine[]): Promise<StockCheckResult>   // lib/supplierStock.ts
  → definitive:true && ok:false → 주문 hard-stop (품절 확정)
  → definitive:false → 기존 시트 옵션별재고 검증으로 폴백 (현재 동작 유지)
registerStockAdapter(adapter: StockAdapter)  // Session B 백엔드 주입점 (lib/stock/* 와 분리)

POST /api/orders body.idempotency_key  // CheckoutFlow가 이미 전송 중 — 응답 duplicate:true 처리 가능
상태 확정: 생성 응답 status="PAYMENT_PENDING" / status_label 표시용
```

### Session I (Return Flow)
```
canTransition / assertTransition(from, to)            // RETURN_REQUESTED 계열 전이 가드
readOrderStatus({ paymentStatus, shipStatus, csMemo }) // 시트 레코드 → canonical 판독(반품요청 태그 포함)
projectOrderForOwner(record)                           // 반품 대상 주문 owner 뷰
confirmMemoAlreadyRequested(memo)                      // CS메모 중복 기록 방지 규칙 재사용
```

### Session J
- 주문/조회 API는 모두 소유 검증 후 `projectOrderForOwner` 형태로 응답 — UI는 이 projection을
  그대로 소비하면 된다. 상태 칩은 `status_label` 사용 권장.

---

## 9. 알려진 한계 (정직 기록)

1. **auth 세션의 인메모리 특성**: 회원내역 GET은 auth core의 전역 세션 맵을 읽는다 —
   serverless 인스턴스가 바뀌면 토큰 무효(로그인 상태 자체도 동일 한계). auth core 무수정 원칙에 따라
   이번 세션에선 읽기만 하고, 세션의 시트/서명토큰 이관은 다음 세션 과제로 남긴다.
   (주문 데이터 자체는 시트에 영구 — 이메일 일치 조회이므로 세션만 살아있으면 항상 복구 가능)
2. **멱등 2층의 잔여 리스크**: 서로 다른 인스턴스에서 동일 키가 '동시에' 도착하면 시트 검사-삽입
   사이 미세한 cross-instance race는 이론상 남는다(시트엔 락이 없음). in-flight 수렴이 같은 인스턴스
   동시성을 전부 흡수하므로 실질 노출은 극히 작다. 완전 차단이 필요해지면 멱등키 전용 시트나
   DB unique 제약 도입을 권장.
3. **Session B 진행 중 타입 에러**: `lib/stock/normalize.ts`에 downlevelIteration 계열 에러 2건 —
   B 소유, 무접촉. B 정리 후 `next build` 게이트 통과 예정.
4. **lookup 연속 조회 rate limit 미장착**: 주문번호+연락처 완전 일치 요구가 실효 방어이나,
   무차별 대입 지연용 throttle은 다음 세션에서 검토.

---

## 10. 변경 파일 목록

**신규**: `lib/orderState.ts`, `lib/idempotency.ts`, `lib/orderView.ts`, `lib/supplierStock.ts`,
`app/api/orders/lookup/route.ts`, `tests/commerce.test.cjs`, 본 리포트
**수정**: `lib/cart.ts`(persistence 계약 추가), `lib/sheets.ts`(멱등키 컬럼/조회 3종 추가),
`components/CartProvider.tsx`(신원 전환·병합 연결), `components/CheckoutFlow.tsx`(멱등키 전송),
`app/api/orders/route.ts`(멱등키+GET), `app/api/orders/confirm/route.ts`(중복 제거)
**무접촉**: `components/AuthProvider.tsx`, `app/api/auth/route.ts`(auth core),
`lib/stock/*`·`mission-20260909/*`(Session B 실행 영역), `lib/payments.ts`, `lib/checkout.ts`,
`components/CartDrawer.tsx`, `components/FloatingOrderTracker.tsx`

**SESSION C 완료 — STOP.**
