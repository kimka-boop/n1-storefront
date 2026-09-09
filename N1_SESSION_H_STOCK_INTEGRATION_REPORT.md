# N1_SESSION_H_STOCK_INTEGRATION_REPORT.md

> **SESSION H — STOCK FRONTEND + CHECKOUT INTEGRATION** · 2026-09-09
> 브랜치: **`n1-stock-frontend-checkout`** (commit `21be1ae`, base = `3674ee9` = WAVE1_BASE 통합 상태)
> 범위: **TASKS 11 · 13 · 14** — B(Stock backend)의 `n1.stock.v1` 계약과 C(Commerce)의
> `finalStockCheck` 경계를 PDP 표시·Checkout 최종 재검증으로 연결.
> 결과: **테스트 156/156 PASS (H1–H8 신설 8 포함) · `tsc --noEmit` clean · `next build` ok ·
> 런타임 HTTP 스모크 7항목 통과. 기능은 창작 금지 계약 위반 0건.**

---

## 0. 요약 — 무엇이 연결되었나

Session B가 남긴 것: 검증 원장(`Stock_Staging`/ledger) + 읽기 API `GET /api/stock`
(`n1.stock.v1`) + C 경계용 어댑터 팩토리 `createStockBackendAdapter` (주입은 H 소관).
Session C가 남긴 것: `lib/supplierStock.ts`의 `registerStockAdapter` / `finalStockCheck`
경계 (연결은 H 소관) + CheckoutFlow/`/api/orders`.

Session H가 이번에 물린 것:

1. **PDP** — `/api/stock?sku=`를 조회해 **검증된 숫자 옵션 재고만** "N개 남음"으로 표시
   (옵션 선택 아래·가격 위, 작은 metadata). binary/unknown은 숫자 없음, STALE은 count 숨김.
2. **Checkout** — `/api/orders` 생성 경로의 **결제 개시 직전**에 `finalStockCheck`로 선택한
   정확한 옵션(color×size)을 재검증. 확정 품절/수량부족만 409로 결제 중단(카트 유지·truthful
   메시지), 미확정은 C 원본(Products 옵션별재고) 폴백.
3. **재고 차감 교체** — 기존 Products AB열 차감이 `unisex_score`를 오염시키는 지뢰(B 리포트
   지뢰 1)를 제거하고 `Stock_Staging` 기준(확인 숫자만·검증일시 불변)으로 교체.
4. **기존 copy 제거** — 모든 상품이 띄우던 "옵션 재고가 확인 중입니다 — 고객센터로 문의해
   주시면…" 제거. `/api/stock` 조회 실패(lookup failure)일 때만 별도 truthful fallback.

현재 데이터 상태(정직 기록): **44개 전 상품이 NOT_STAGED/UNKNOWN**이다(HERMES staging 이전).
따라서 지금 PDP에는 어떤 숫자도 표시되지 않고, 주문 생성은 "재고 미확인(품절이 아님)" 409로
차단된다 — 이것이 계약상 올바른 상태다(B 리포트: "이것이 정상이다"). HERMES가 Stock_Staging을
채우는 순간 별도 코드 변경 없이 숫자·구매 가능·차감이 자동으로 살아난다.

## 1. TASK 11 — PDP STOCK ("N개 남음")

**위치**: Scene 6 구매 레이어 — 사이즈 선택 행 아래·가격 위. `styles.stockCount`
(12px·#66685f — 기존 holdNotice 계열의 조용한 metadata 톤).

**표시 규칙** (`lib/stockDisplay.ts → pdpStockState()`, 순수 함수):

| 데이터 상태 | 표시 | 구매 CTA |
| --- | --- | --- |
| FRESH + 옵션행 `quantity: N` (N≥1) | **"N개 남음"** + 수량 상한 N | 활성(ready) |
| FRESH + 옵션행 `quantity: 0` / `available: false` | 숫자 없음 | 품절 |
| FRESH + binary `available: true` (수량 null) | **숫자 없음 — 창작 금지** | 재고 확인 후 구매 가능(CS) |
| FRESH + 옵션행 없음·상품 단위 수량 | count 없음(옵션 숫자가 아니므로) | 활성(서버 어댑터와 동일 규칙) |
| STALE / 재고검증일시 null | **count 숨김** (숫자가 있어도) | 재고 확인 후 구매 가능 |
| 미스테이징(UNKNOWN) | 표시 없음 | 재고 확인 후 구매 가능 |
| `/api/stock` 조회 실패 | 표시 없음 + 별도 실패 안내(§4) | 재고 확인 후 구매 가능 |

- `null`을 0으로 다루지 않는다 — 미확인은 "확인 중"이지 품절이 아니다 (B 절대 규칙 준수).
- 부수 완성: 시트 `sizeOptions`가 비어 있어도(현재 44개 전부) FRESH 검증 옵션행의
  사이즈로 사이즈 칩을 완성하고, 확인 수량으로 수량 선택 상한을 cap한다 — 반드시 실패할
  주문(초과 수량)을 서버에 보내기 전에 막는다.
- 구매 활성화 판정은 **서버가 수락할 선택만** 연다(`effectiveBuyState`) — PDP에서 열었는데
  서버가 거절하는 부정합을 만들지 않는다.
- 스냅샷: `CartItem.stock_snapshot`을 B 검증 count 우선값으로 승격(표시 참고용 — 원본은 서버).

## 2. FRESHNESS (TASK H3)

- PDP는 API의 `fresh` 플래그를blindly 믿지 않고 **원시 `stockVerifiedAt`를 클라이언트에서
  재판정**한다(`freshnessOf`, FRESH ≤ 24h) — 오래 열려 있던 페이지에서 STALE 값이 숫자로
  남아 있는 것을 방지한다.
- STALE이면: count 숨김 · 구매 비확정 · **품절로도 만들지 않는다**(미확인 ≠ 품절).
- 서버 게이트도 동일: 어댑터는 FRESH 검증값만 `definitive`로 판정한다(H3에서 STALE 0도
  "품절 확정"이 아님을 실측).

## 3. TASK 13 — CHECKOUT FINAL RECHECK

**접속부** (`lib/stockCheckout.ts`):
- `checkoutFinalStockCheck(lines)` — C의 `finalStockCheck()` 직전에
  `registerStockAdapter(createStockBackendAdapter(loader, new Date()))`로 B 어댑터를 주입한다.
  **호출마다 새 시계**로 판다 — 장기 구동 프로세스에서 freshness가 등록 시각에 얼어붙는
  것을 방지(B 어댑터 팩토리의 기본 인자 함정 회피, B 파일 무수정).
- loader는 `/api/stock`과 동일 우선순위: `Stock_Staging`(1순위) → 로컬 원장 미러(2순위) → 빈 값.
  sku 단위 병합. 시트 도달 실패는 null 폴백 — 판정 보류(품절 창작 금지).

**게이트 위치** (`/api/orders → createOrderRecord`): 입력 검증·가격 재계산·**멱등키 replay
판정 뒤**, 고객 upsert·Orders 인입·차감·텔레그램(=결제 개시) **직전**. replay 뒤에 두는
이유: 이미 생성된 주문의 재제출은 재고 변동과 무관하게 원본 응답을 replay해야 하기
때문(멱등성 계약 보존 — C §7).

**판정 순서** (`lib/stockGate.ts`, 순수 함수):
1. `finalStockCheck` 확정(`definitive:true`)이면 그 판정을 따른다 — `ok:false`만
   409 차단: `품절: … — 확인된 재고가 없어 결제를 진행하지 못했습니다` /
   `재고 부족: … — 잔여 N개`.
2. 미확정(미스테이징·STALE·binary 수량미확인·**조회 실패**)이면 C 원본 폴백:
   Products `옵션별재고`에서 **정확히 일치하는 옵션 키만** 읽는다. 값이 없으면
   `재고 미확인: … (품절이 아님)` 409. 기존의 "없으면 전체 옵션 max值" 휴리스틱과
   colorIndex 키 추론은 제거했다 — 확인된 값만 판정에 쓴다.
3. 폴백 통과(시트 값 ≥ 요청)면 주문 진행.

**클라이언트** (`components/CheckoutFlow.tsx`): 409면 서버의 truthful 메시지에
`— 장바구니는 그대로 유지됩니다.`를 붙여 표시. 카트 비움은 성공 경로에서만 일어나므로
구조적으로 유지된다(H6에서 소스 계약 검증).

**재고 차감 교체** (B 지뢰 1 해소):
- 제거: `stockSheet.getCell(row, 27)` AB열 쓰기 — 신규 Products 시트의 AB열은
  `unisex_score`라 **실 데이터 오염** 경로였다(주문 1건마다 k:v|k:v 문자열로 덮어씀).
- 신설: `decrementStagingStock()` — `Stock_Staging` 행의 **확인된 숫자만** 차감
  (`applyOrderDecrement` 순수 계산). **`재고검증일시`는 불변** — 차감은 새 검증이 아니며
  근거는 `비고`의 "주문 차감 ORD-… 키 -N" 기록으로 남는다. staging 미기입 sku는 차감
  보류(로그) — 다음 공급처 재검증(cadence 6h)이 값을 다시 맞춘다. 실패해도 주문을
  되돌리지 않는다(경계 계약).

## 4. TASK 14 — 기존 copy 제거 + lookup failure fallback

- **제거**: `"옵션 재고가 확인 중입니다 — 고객센터로 문의해 주시면 준비를 도와드립니다."`
  — 정상 재고 파이프라인(조회 성공)에서는 더 이상 출력되지 않는다. 미확인 상태는 조용한
  CTA("재고 확인 후 구매 가능" — 클릭 시 CS 오픈)만으로 소통한다. 빌드 산물 전체
  (`.next/`)에서 해당 문자열 잔존 **0건** 실측.
- **별도 fallback**: `/api/stock` 조회 실패(non-200·계약 위반·파싱 실패)일 때만
  `"재고 정보를 불러오지 못했습니다 — 잠시 후 새로고침해 주세요."` — "확인 중"(진행
  주장)이 아니라 "실패"(실패 사실)를 말한다. 미확인(데이터 없음)과 조회 실패(인프라
  문제)를 구분하는 것이 이번 태스크의 요지다.

## 5. 소유권 존중 — 누구 파일을 어디까지 만졌나

| 파일 | 소유 | H의 변경 |
| --- | --- | --- |
| `lib/stockGate.ts` · `lib/stockDisplay.ts` · `lib/stockCheckout.ts` | **H 신설** | 순수 판정·표시 로직 + 서버 배선 |
| `tests/stockIntegration.test.cjs` | **H 신설** | H1–H8 |
| `app/api/orders/route.ts` | C | TASK 13이 명시한 연결부만: 재고 확인 루프→3.7 게이트로 이동·교체, AB 차감→Staging 차감. 멱등성 2층·가격 재계산·회원 조회·분리배송·텔레그램 무수정 |
| `app/product/[id]/page.tsx` · `product.module.css` | (디테일 경험) | 재고 fetch·count 요소·effBuy·사이즈 보완·qty cap·copy 제거. hooks는 early return 이전 배치(규칙 준수) |
| `components/CheckoutFlow.tsx` | C | 409 카트 유지 안내 1곳 |
| B 소유 파일(`lib/stock/*`, `/api/stock`) | B | **무수정** — 어댑터 주입은 설계된 주입점(registerStockAdapter) 사용 |

## 6. 테스트 — H1–H8 (`node --test tests/stockIntegration.test.cjs`, 8/8 PASS)

| # | 시나리오 | 핵심 단언 |
| --- | --- | --- |
| H1 | exact N | FRESH TYPE A 옵션 5 → `countLabel "5개 남음"`·capQty 5·buyable (37 → "37개 남음") |
| H2 | binary no number | available=true → count **null**(0 아님)·라벨 없음·buyable false. available=false → 품절·"0개 남음" 창작 없음 |
| H3 | stale | 검증 72h 전 → count 숨김·buyable false·**soldout false**. 서버도 STALE 0을 품절 확정하지 않음 |
| H4 | color/size change | 블랙/M→"5개 남음", 블랙/L→"2개 남음", 네이비/M→품절. 색상별 사이즈 후보·cap 추종·choose/ready 전이 |
| H5 | checkout available | FRESH 5 ≥ 요청 2 → definitive·ok·게이트 통과(결제 진행). 상품 단위 37도 확정 통과 |
| H6 | checkout soldout | 요청 7 > 5 → 409 차단·`잔여 5개` 안내. available=false → 품절. CheckoutFlow 카트 유지 문구+성공 경로에서만 clearCart(소스 계약) |
| H7 | source failure | loader throw → ok:**null**(false 아님)·definitive:false → 시트 폴백 → `재고 미확인(품절이 아님)`. PDP lookup failed → 별도 fallback 문구. **구 copy가 page.tsx에 없음**(소스 실측) |
| H8 | no false reserve claim | 어댑터 `reserve` 미구현·모든 노출 문구에 예약/확보/선점 주장 0건. 차감 기록은 "주문 차감"·검증시각 불변·미확인 null은 차감하지 않음 |

전체 회귀: `node --test tests/*.test.cjs` → **156/156 PASS** (기존 148 + H 8).
`npx tsc --noEmit` clean · `next build` ok.

## 7. 런타임 스모크 (:3322 prod, 실측 후 종료)

| # | 검증 | 결과 |
| --- | --- | --- |
| 1 | `GET /api/stock?sku=PRD-N1-01` | 200 · `n1.stock.v1` · NOT_STAGED/UNKNOWN 정직 응답(null, 0 아님) |
| 2 | `GET /product/PRD-N1-01` | 200 (PDP 셸) |
| 3 | `GET /checkout` | 200 |
| 4 | `POST /api/orders` 빈 본문 | 400 필수 항목 안내 (C 계약 유지) |
| 5 | `POST /api/orders` 유효 형상(미스테이징 상품) | **409 `재고 미확인: … (품절이 아님)`** — 게이트가 최초 쓰기(고객 upsert) **이전에** 차단 → 시트 쓰기 0건 경로로 실측 |
| 6 | 빌드 산물 copy 검사 | `.next/` 전체에서 기존 "확인 중" copy **0건** |
| 7 | 빌드 산물 신규 copy | PDP 청크에 "N개 남음"·"불러오지 못했습니다", checkout 체크에 "장바구니는 그대로 유지됩니다" 존재 |

정직 경계: 스모크 #5는 게이트가 쓰기 전에 차단하는 경로라 시트·텔레그램 쓰기가 발생하지
않는다(코드 경로 순서 + 409 응답 실측). 실 주문 생성·입금 확인은 실행하지 않았다.

## 8. Mimosa 스캔 (커밋 훅 보완)

normal 깊이 스캔 완료: `scan-2026-09-09T01-59-12.288Z-e52dcf36bd96`,
seal `sha256:3fa5449…bff0`, findings 7 — **전부 타 세션 파일의 기존 항목**
(SmartFitFlow.tsx 하드코딩 비밀값 후보 1, telegram SSRF 후보 4, recompute_pairs.py
경로 후보 1, 의존성 offline advisory 5패키지/34건 — context-only). **Session H 신설·수정
파일에서 신규 발견 0건.** 본 보고서는 "프로젝트 전체 안전"을 주장하지 않는다 — 위
7건의 실데이터플로 확인은 소유 세션·Owner 몫으로 남긴다.

## 9. 잔여 사항 (이월)

1. 44개 전 상품 NOT_STAGED — HERMES staging(또는 watcher `--stage`)이 선행되면 이번
   통합이 자동으로 살아난다(코드 변경 불요).
2. `Stock_Staging`에 HERMES와 주문 차감이 같은 탭에 쓴다 — cadence 재검증이 값을 다시
   맞추는 구조지만, 쓰기 충돌 정책(행 단위 save)은 운영 관찰 권장.
3. 병합 게이트(차기): H 브랜치를 wave1 통합 브랜치에 합칠 때 H1–H8 + 148 회귀 재실행.
4. 미확인 상품의 구매 활성화는 Promotion(Products 재고 5컬럼 추가, B 리포트 지뢰 2
   절차) 이후 시트 경로에서도 자연 확장된다 — 본 세션의 폴백이 이미 그 값을 읽는다.

---
*Session H 완료 — TASKS 11·13·14 · output 본 파일 · 이후 STOP.*
