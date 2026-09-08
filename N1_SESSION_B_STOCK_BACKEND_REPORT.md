# N1_SESSION_B_STOCK_BACKEND_REPORT

작성: 2026-09-09 · SESSION B (Tasks 10 + 12) — 재고 데이터 생성/검증/동기화 backend
브랜치: `n1-commerce-cs-v1` 작업트리 (커밋 없음 — 운영 판단 대기)
범위 준수: PDP 표시와 Checkout recheck **수정 없음** (Session H 소관). 본 세션은 backend + read API만.

---

## TL;DR

1. launch catalog 44건의 유일 공급처는 **도매꾹**. 재고의 결정적 소스는 도매꾹 OpenAPI
   `getItemView ver=4.6`(`qty.inventory` 숫자재고 + `basis.status` 판매상태)다. 상품 단위 숫자는
   **문서 근거로 TYPE A 후보**이며, 옵션별 수량(`selectOpt`)은 **스키마 미검증 = TYPE D** —
   검증 전까지 옵션 수량은 절대 숫자로 만들지 않는다(창작 금지 준수).
2. credential 없이 동작하는 **결정적 watcher + HERMES bridge**를 구축했다. 키가 없으면 공급처 호출을
   시도조차 하지 않고 프로브 요청을 큐에 적재한다(실측 확인: 44건 큐 적재, 호출 0건).
   큐 소화·시트 staging write/readback은 HERMES에 요청 완료(`hermes_bridge/2026-09-09_stock_backend_hermes_request.md`).
3. Session H가 사용할 stable read API **`GET /api/stock` (contract `n1.stock.v1`)** 제공 —
   §6이 이 보고서의 핵심 산출물이다. Checkout/PDP 코드는 한 줄도 수정하지 않았다.

---

## 1. CURRENT SOURCE MAP (미션 §1)

전체 44건 상세: `mission-20260909/N1_STOCK_SOURCE_MAP.json` (44 rows, 기계판독용)

| 항목 | 값 |
| --- | --- |
| 공급처 | 도매꾹 44/44 (단일 공급처) |
| supplier URL | `http://domeggook.com/<no>` (normalize 시 `https://www.domeggook.com/<no>`로 강제) |
| product ID | `source_product_id` = 도매꾹 상품번호 `no` (예: PRD-N1-01 ↔ 67853341) |
| options | colors 0~3개(제목 토큰 유래), sizes 전건 미확정 — 옵션 정체성 basis = `TITLE_TOKENS_ONLY` |
| 현재 재고 필드 | Products 시트 `재고상태=판매중`(스왑 시점 API 존재 신호), 검증시각/수량/옵션별재고 **컬럼 자체가 없음** |

현재 상태의 정직한 요약: **44건 모두 "검증된 재고 값이 없는" 상태**다. `판매중`은 2026-09-09 06시 전후
getItemList 소싱 시점의 존재 신호이지 현재 재고가 아니다.

## 2. SOURCE TYPE 분류 (미션 §2) — 문서 + 실측 근거

| 레벨 | 유형 | 근거 |
| --- | --- | --- |
| 상품 단위 숫자 | **A (후보 — 실측 대기)** | 도매꾹 OpenAPI 문서: getItemView v4.6 `qty.inventory`(재고수량). HERMES 실측 스키마 검증(STEP 1) 전까지 confidence=MEDIUM |
| 상품 단위 상태 | **B (확정)** | getItemView `basis.status`(판매중/기간종료/판매종료) + getItemList는 **판매중 상품만 반환**(판매중지·판매종료 제외 — 문서+기존 소싱 실측) |
| 옵션 단위 숫자 | **D (구조 미확인)** | getItemView `selectOpt` = "별도 문서 참조"(별첨 docx). 검증된 필드 구조가 없으므로 임의 파싱 = 창작. HERMES STEP 1에서 스키마 확정 시 `parseSelectOpt()`만 교체 |
| 옵션 단위 품절 | **B (적용성 미검증)** | getAllSupplyChk `OPTSOLDOUT/OPTRESTART` 이벤트(문서 확정). 단, v1.1은 회원 `id`+`sId` 필수 → 바이어 계정 적용 가능성 HERMES STEP 4 검증 전까지 비활성 |
| 공개 상세페이지 HTML | **파서 실패** | enrich 실측(2026-09-09): 44/44 전건 colors/sizes/price 미획득. 이 경로는 결정적 파서 실패 사례로 HERMES 에스컬레이션 대상 — "브라우저 상호작용 필요(TYPE C)"로 판단할 근거 없음 (API가 존재하므로 C 불필요) |

**숫자가 없는 source에서 N개 창작 금지는 코드 계약으로 구현됐다**: 미확인 수량은 `null`(0과 다름),
파서는 문서에 확인된 필드만 읽고 모르는 구조는 `OPTION_AMBIGUITY`/`PARSER_FAILURE` 에스컬레이션.

## 3. STOCK MODEL (미션 §3) — 기존 schema 호환

`lib/stock/types.ts` — 단일 모델 `StockRecord`:

```
productId           "PRD-N1-01" (Products 시트 상품ID — 기존 키 그대로)
supplierName        "도매꾹"
supplierProductId   "67853341" (원본 공급처 ID 유지)
supplierUrl         원본 URL 유지
stockStatus         "판매중" | "품절" | "판매종료" | "UNKNOWN"   ← 기존 재고상태 어휘
stockQuantity       number | null   ← null = 숫자 미확인 (0은 "확인된 0")
stockType           "A"|"B"|"C"|"D"|"UNKNOWN"
stockVerifiedAt     ISO | null      ← 이 값 기준으로 fresh/stale
stockSource         "domeggook.getItemView.4.6" | "NOT_STAGED" | …
stockConfidence     "HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"
optionStock         [{ optionKey, color, size, quantity|null, available|null, rawLabel }]
notes               파생 근거 (예: "재고수량 0 확인 → 품절 파생")
```

호환 계약:
- **옵션 키 규약** `optionKey = color ? `${color}_${size}` : size` — `lib/experience.purchaseState`와
  `/api/orders` 차감 키와 동일 규약(`lib/stock/normalize.ts buildOptionKey`).
- **시트 `옵션별재고` 직렬화** `k:v|k:v` — `catalog.ts parseStock`·`/api/orders` 파서와 같은 포맷.
  확인된 정수 수량만 직렬화(null·음수 배제).
- **원본 옵션 정체성** `rawLabel` + 전체 entry JSON(`옵션원본` 컬럼)으로 보존 — `k:v` 손실 없음.
- 파생 규칙: `판매중 + qty=0 → 품절(파생, notes 기록)`. `기간종료/판매종료 → 판매종료`.

## 4. DETERMINISTIC WATCHER + HERMES (미션 §4·§5)

```
[cycle]  stock_watcher.cjs --cycle
   키 있음(direct)  → getItemView(no, ver=4.6) 결정적 호출(1.2s 간격) → 파서 → 원장(ledger.json)
   키 없음(bridge)  → 공급처 호출 0건, outbound/PB-*.json 프로브 요청만 적재
[bridge] HERMES: outbound 소화(API key 사용) → inbound/probe-result-*.json(raw 원문)
   → --ingest: 동일 파서 경로로 원장 반영 (HERMES 결과든 direct든 파서는 하나)
[stage]  --stage → outbound/SW-*.json (Stock_Staging write 요청, 기대 rows 포함)
   → HERMES: 신규 탭 Stock_Staging write → 전체 readback → inbound/staging-readback-*.json
   → validateReadback() 불일치 판정 (조용한 덮어쓰기 없음)
[escalate] 파서 실패/레이아웃 변경/옵션 모호성/도달불가만 escalations/로 적재 → HERMES 추론 대상.
   LLM이 매번 공급처 페이지를 읽는 경로는 존재하지 않는다.
```

- 파서 실패 시 **이전 검증값 무변형 보존**(검증시각 그대로 → 자연 스털화). B5 테스트로 검증.
- cadence (미션 §6, `DOMEGGOOK_CADENCE`): 상품당 item_view **6h + 결정적 지터 15m**, 일일 상한
  4회/상품, 실패 시 지수 백오프(상한 48h), 호출 간 1.2s. 무한 polling 없음.
- anti-bot bypass 일체 없음: 문서화된 공개 OpenAPI만, 표준 UA, 순차 호출, 동일 호스트 외 리다이렉트
  미추종, `normalizeSupplierUrl()`로 localhost/loopback/사설/예약 호스트 하드 차단(SSRF 가드).

## 5. FRESHNESS (미션 §7)

`freshnessOf(stockVerifiedAt, now)` — **FRESH ≤ 24h**, 그 밖 STALE, 검증 이력 없으면 UNKNOWN
(`FRESH_WINDOW_HOURS = 24`, cadence 6h보다 넓게 — 소스 장애 시에도 하루는 "확인된 값"으로 유지).
API는 `freshness`(enum) + `fresh`(bool) + `stockVerifiedAt`(원시 ISO)를 모두 주므로 Session H가
자체 정책(예: checkout에서 1h 창)으로 재판정할 수 있다.

## 6. ★ SESSION H가 사용할 EXACT API CONTRACT (미션 §8 handoff)

**`GET /api/stock` — 읽기 전용, contract version `n1.stock.v1`, 파일 `app/api/stock/route.ts`**

쿼리:

| 형태 | 용도 |
| --- | --- |
| `?skus=PRD-N1-01,PRD-N1-02` | **Checkout recheck용 배치** (존재하지 않는 sku는 무시되지 않고 unknown 레코드로 응답) |
| `?sku=PRD-N1-01` | 단건 (PDP) |
| (쿼리 없음) | 스테이징/원장에 존재하는 전체 |

응답 (200, 항상):

```json
{
  "ok": true,
  "contractVersion": "n1.stock.v1",
  "checkedAt": "2026-09-09T12:00:00.000Z",
  "stagedReadable": false,
  "stocks": {
    "PRD-N1-01": {
      "productId": "PRD-N1-01",
      "stockStatus": "판매중",            // "판매중"|"품절"|"판매종료"|"UNKNOWN"
      "stockQuantity": 37,                // number | null — null은 "미확인", 0은 "품절"
      "stockType": "A",                   // "A"|"B"|"C"|"D"|"UNKNOWN"
      "stockVerifiedAt": "2026-09-09T…",  // ISO | null
      "stockSource": "domeggook.getItemView.4.6",
      "stockConfidence": "HIGH",
      "freshness": "FRESH",               // "FRESH"|"STALE"|"UNKNOWN"
      "fresh": true,
      "staged": true,                     // 시트 Stock_Staging에서 왔으면 true (원장 미러는 false)
      "optionStock": [
        { "optionKey": "블랙_M", "color": "블랙", "size": "M",
          "quantity": 5, "available": true, "rawLabel": "블랙/M (재고5)" },
        { "optionKey": "블랙_L", "color": "블랙", "size": "L",
          "quantity": null, "available": null, "rawLabel": "블랙/L" }
      ],
      "supplier": { "name": "도매꾹", "productId": "67853341", "url": "https://www.domeggook.com/67853341" }
    },
    "PRD-N1-02": { "…": "미스테이징 상품 예", "stockStatus": "UNKNOWN", "stockQuantity": null,
                   "stockType": "UNKNOWN", "stockVerifiedAt": null, "stockSource": "NOT_STAGED",
                   "stockConfidence": "UNKNOWN", "freshness": "UNKNOWN", "fresh": false, "staged": false,
                   "optionStock": [], "supplier": { "name": "", "productId": "", "url": "" } }
  },
  "missing": ["PRD-99-99"]
}
```

400: `sku`/`skus` 파라미터가 빈 값일 때만 (`{ok:false, error}`). 그 외 오류도 200 + UNKNOWN 레코드로
정직 응답(재고 조회 실패를 "품절"로 표현하지 않는다).

**Session H 통합 규칙 (권장 분기 — 기존 purchaseState 어휘와 1:1):**

| 조건 | 권장 분기 |
| --- | --- |
| `stockStatus === "품절"` 또는 (`stockQuantity === 0`) | soldout |
| `stockQuantity !== null && requestedQty > stockQuantity` | 수량 초과 — 잔여 안내 |
| `optionStock`에서 해당 optionKey의 `quantity !== null` | 그 숫자로 옵션별 판정 (purchaseState와 동일 키) |
| `available === false` | 그 옵션 soldout (binary — 수량 없음) |
| `freshness === "STALE"` 또는 `stockVerifiedAt === null` | **"재고 확인 중" 정직 상태** (unconfirmed) — 구매 버튼 막고 CS 유도가 현 정책 |
| `stocks`에 키 자체가 없음 + `missing`에 있음 | 잘못된 sku |

- **절대 규칙**: `stockQuantity: null`을 0으로 취급하지 마라. 미확인 = 확인 중이지 품절이 아니다.
- 읽기 우선순위: 시트 `Stock_Staging` 탭(1순위, `staged:true`) → 로컬 원장 미러(`staged:false`) → UNKNOWN.
- 현재(HERMES STEP 2/3 실행 전) 모든 44건은 `NOT_STAGED/UNKNOWN`으로 응답한다 — 이것이 정상이다.

### Checkout recheck — Session C 경계와의 접속 (이미 구현됨)

Session C가 남긴 `lib/supplierStock.ts` 경계(`registerStockAdapter` / `finalStockCheck`)에 대한
공식 구현을 `lib/stock/adapter.ts`에 제공했다:

```ts
import { createStockBackendAdapter } from "@/lib/stock/adapter";
import { registerStockAdapter } from "@/lib/supplierStock";
registerStockAdapter(createStockBackendAdapter(() => ledgerLoader())); // Session H가 1회 주입
```

- 확정 규칙: FRESH한 검증값 라인만 `definitive:true`로 판정(수량≥요청 → ok, 초과 → !ok, 옵션 품절
  확인 → !ok). STALE/NOT_STAGED/TYPE B 수량 미확인은 `ok:null` — 품절로 판정하지 않는다.
- 결제 시점 공급처 실시간 호출은 하지 않는다(cadence 정책 준수). 실시간 재확인이 필요하면
  `GET /api/stock?skus=` 또는 HERMES bridge 프로브 트리거.

## 7. TEST RESULTS (미션 §9)

`node --test tests/*.test.cjs` → **98/98 pass** (기존 88 + 신규 10). `npx tsc --noEmit` clean.

| 테스트 | 케이스 | 결과 |
| --- | --- | --- |
| B1 | exact stock — qty.inventory=37 왜곡 없이 보존, TYPE A/HIGH | pass |
| B2 | binary only — 수량 미확인 null (0 창작 없음), TYPE B/MEDIUM | pass |
| B3 | soldout — 판매종료, qty=0→품절 파생(+notes), OPTSOLDOUT binary | pass |
| B4 | option mapping — `color_size` 키 규약, 시트 직렬화 왕복(catalog.ts·/api/orders 호환), rawLabel 보존, selectOpt 모호성 에스컬레이션 | pass |
| B5 | parser failure — LAYOUT_CHANGE/PARSER_FAILURE 에스컬레이션, 이전 검증값 무변형 | pass |
| B6 | stale — 24h 창, 미검증/무효 타임스탬프 UNKNOWN | pass |
| B7 | sheet write/readback — staging rows 생성, 변조(12→11) 탐지, readback→레코드 복원, 원장 최신승 병합 | pass |
| B8 | API read contract — n1.stock.v1 필드·fresh·staged·missing 계약 고정 | pass |
| 보조 | Session C 경계 어댑터 — 확정/미확정 판정(STALE은 품절 아님), 수량 초과 확정 거절 | pass |
| 보조 | cadence(6h/지터/일일상한/백오프), SSRF 가드(localhost·127.·169.254.·사설·비허용호스트·ftp 차단), direct/bridge 사이클(bridge에서 호출 0건) | pass |

러너 실측: `node mission-20260909/stock_watcher.cjs --cycle` (키 없음) → **44건 bridge 큐 적재,
공급처 호출 0건, credential 무접촉** 확인. 큐 파일에 키/시크릿 없음.

## 8. Session H에게 넘기는 지뢰 2개 (이 세션에서 고치지 않음)

1. **`/api/orders`의 AB열 재고 차감은 현재 위험하다.** 신규 Products(44행)의 28번째 컬럼(AB)은
   `unisex_score`다 — 기존 차감 코드(`stockSheet.getCell(row, 27)` → AB를 옵션별재고로 간주)는
   스왑 전 60행 구버전 시트 가정이고, 지금 그대로 주문이 들어가면 `unisex_score`를 `k:v|k:v`로 덮어쓴다.
   Checkout recheck 통합 시(Session H 소관) 차감/재검증을 `/api/stock` + `Stock_Staging` 기준으로
   교체하라. 이 세션은 `/api/orders`를 한 줄도 수정하지 않았다.
2. **Products 시트에 `옵션별재고` 컬럼이 없다.** `catalog.ts parseStock`은 빈 문자열 → `{}`로 정직
   동작하지만, 컬럼이 생기기 전까지 PDP `optionStock`은 항상 비어 있다. HERMES staging 이후
   Promotion(Products에 재고 5컬럼 추가 — HERMES 스왑 패턴과 동일 절차)이 선행되면 자연 해소.

## 9. FILES

| 파일 | 역할 |
| --- | --- |
| `lib/stock/types.ts` | StockRecord·ProbeFact·에스컬레이션·뷰 타입 계약 |
| `lib/stock/normalize.ts` | 순수 정규화(옵션키·직렬화·상태 도출·freshness·staging 행·readback 검증) |
| `lib/stock/sources.ts` | 도매꾹 프로브 정의·SSRF 가드·결정적 파서(getItemView/목록 존재/품절 이벤트) |
| `lib/stock/watcher.ts` | cadence 플랜·ingest·1 사이클 오케스트레이션(I/O 주입) |
| `lib/stock/bridge.ts` | HERMES 큐 계약(프로브 요청·결과·staging write·readback) |
| `lib/stock/ledger.ts` | 로컬 원장 미러 + 감사 로그 |
| `lib/stock/adapter.ts` | **Session C 경계 구현** — supplierStock `registerStockAdapter` 주입용 어댑터 |
| `app/api/stock/route.ts` | **`GET /api/stock` — n1.stock.v1 (Session H 소비점)** |
| `tests/stock.test.cjs` | B1~B8 + 어댑터 + cadence/SSRF/사이클 (10 tests) |
| `mission-20260909/stock_watcher.cjs` | 러너: `--cycle --ingest --stage --status` |
| `mission-20260909/N1_STOCK_SOURCE_MAP.json` | 44건 소스맵 + 유형 분류 (기계판독) |
| `mission-20260909/N1_STOCK_BRIDGE/` | outbound 44건 대기 / inbound / escalations / ledger |
| `hermes_bridge/2026-09-09_stock_backend_hermes_request.md` | HERMES 실행 요청 (STEP 1~4 + 회신 양식) |

## 10. 미해결 (HERMES 회신 후 결정)

- `qty.inventory` 실측 확정 → 상품 단위 TYPE A confidence HIGH 승격.
- `selectOpt` 스키마 → 옵션 단위 숫자(A) 또는 binary(B) 확정, `parseSelectOpt()` 교체.
- getAllSupplyChk 바이어 적용성 → 적합 시 옵션 품절 이벤트 구독 경로 활성.

세션 B 범위 완료. PDP/Checkout 수정 없음. — STOP.
