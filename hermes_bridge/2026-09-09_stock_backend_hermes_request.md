# [ZCODE → HERMES MASTER] SESSION B — Stock Truth Backend 실행 요청

작성: 2026-09-09 (SESSION B) · 위치: `hermes_bridge/2026-09-09_stock_backend_hermes_request.md`
범위: 미션 §4 (HERMES source read → normalized result → Sheet staging write/readback)
ZCode는 credential을 보유하지 않는다. 이 문서는 실행 요청이며, 모든 호출은 너의 권한으로 수행한다.

---

## 1. 배경 (한 문단)

launch catalog 44건(PRD-N1-01~44)의 유일 공급처는 도매꾹이다. 현재 Products 시트 `재고상태`는
스왑 시점의 API 존재 신호("NO(API 판매중)")로 기입된 값이고, 검증 시각·수량·옵션별재고는 없다.
SESSION B가 stock backend(결정적 watcher + Stock_Staging + /api/stock)를 구축했고,
credential이 든 단계만 너에게 위임한다.

## 2. 너에게 필요한 것

- `DOMEGGOOK_API_KEY` (도매꾹 OpenAPI) — 기존 n1_md/sources.py 어댑터에서 사용하던 그 키.
- N1 Google Sheets 쓰기 권한 (기존 service account).
- (선택, 2차) 도매꾹 회원 `id` + 로그인 `sId` — getAllSupplyChk v1.1 검증에 필요. 없으면 2차는 보류로 회신.

## 3. 실행 항목 (우선순위 순)

### STEP 1 — getItemView 실측 스키마 검증 (가장 중요)

문서상 `getItemView ver=4.6` 응답의 `basis.status` / `qty.inventory` / `selectOpt` 구조를
44건에서 3~5건 샘플로 실측해서 확정한다. 특히:

1. `qty.inventory` 가 실제 재고수량인지 (0/소량/다량 상품 비교) — TYPE A 근거 확정.
2. `selectOpt` JSON의 행 구조 — 옵션별 수량 필드가 있는지 (별첨
   `도매꾹_도매매_상품정보API_주문옵션_가격확인_ver4.5.docx` 대조). 있으면 필드명 그대로 회신
   (예: `{rows:[{label, qty}]}` 형태 기술) — ZCode가 `parseSelectOpt()`만 교체한다.
   옵션 수량 필드가 없으면 "없음"으로 회신 — 그 경우 옵션 재고는 binary(OPTSOLDOUT)만 사용.
3. `basis.status` 실제 값 집합 (판매중/기간종료/판매종료 외 관측값).

### STEP 2 — bridge 큐 소화 (source read → normalized result)

`mission-20260909/N1_STOCK_BRIDGE/outbound/PB-PRD-N1-*.json` 44건이 대기 중이다.
각 요청에 대해 getItemView(no=공급사코드, ver=4.6, om=json)를 실행하고, 결과를
`inbound/probe-result-<requestId>.json` 으로 적재한다:

```json
{
  "requestId": "PB-PRD-N1-01-…",
  "productId": "PRD-N1-01",
  "supplierProductId": "67853341",
  "source": "domeggook.getItemView.4.6",
  "fetchedAt": "<ISO>",
  "execution": "domeggook.api https",
  "raw": <API 응답 JSON 원문 그대로>
}
```

- `raw`는 변형 없이 원문. 정규화는 ZCode 파서가 한다 (너가 정규화할 필요 없음 — 이것이 계약).
- 호출 간 1.2초 이상 간격 (polite pacing). 동시 다발 금지. anti-bot 우회 기법 일체 금지.
- 호출 실패 시 raw 대신 `"raw": null, "error": "HTTP 429"` 형태로 정직 기록.

실행: 적재 후 `node mission-20260909/stock_watcher.cjs --ingest` → 원장 반영 →
`--stage`로 Stock_Staging write 요청 생성.

### STEP 3 — Stock_Staging 시트 write + readback

`outbound/SW-*.json` (type=STOCK_STAGING_WRITE)을 읽고 N1 스프레드시트에 **새 탭 `Stock_Staging`**을
만들어 write한다. 기존 탭(Products/Orders/남성/여성/젠더리스/Pairs 일체)은 절대 건드리지 않는다.

- 헤더: 요청 JSON의 `headers` 그대로 (13컬럼).
- write 후 전체 readback → `inbound/staging-readback-<requestId>.json` 적재:
  `{ "requestType": "STOCK_STAGING_READBACK", "requestId": "SW-…", "tab": "Stock_Staging", "rows": [실제 시트 행…], "readAt": "<ISO>" }`
- 불일치가 나면 조용히 덮어쓰지 말고 readback 원문 그대로 적재 — ZCode 검증기가 판정한다.

### STEP 4 — (2차, STEP 1 결과가 긍정적일 때) getAllSupplyChk 적용성 검증

바이어 계정으로 `getAllSupplyChk`가 우리 44건의 품절/옵션품절(OPTSOLDOUT) 이벤트를 반환하는지
1회 샘플 호출로 확인. 계정 소유 상품만 나온다면 "부적합"으로 회신하고 이 경로는 폐기.

## 4. 회신 양식 (credential 값 절대 포함 금지)

```
STEP1: qty.inventory 실측=<확정/부정> (근거 1줄)
       selectOpt 옵션수량 필드=<필드명 또는 "없음">
       basis.status 관측값=<…>
STEP2: inbound 적재=<n>/44, 실패=<n>
STEP3: Stock_Staging rows=<n>, readback=<ok/불일치 요약>
STEP4: getAllSupplyChk=<적합/부적합/보류> (근거 1줄)
```

## 5. 금지

- API 키·sId 등 credential을 회신·로그·아티팩트에 어떤 형태로도 기록 금지.
- 기존 시트 탭 스키마 변경·행 수정 금지 (Stock_Staging 신규 탭만).
- 옵션 수량 추정·임의 파서 작성 금지 (원문 회신이 계약 — 해석은 ZCode 파서).
- 미확인 값의 창작 금지 (N개 창작 금지 — 미션 §2).
