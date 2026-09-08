# N1_MASTER_DB_NEXT — 검증 및 스왑 보고서

2026-09-09 · STEP 13–14·23–24 · §3–§5·§28·§32 프로토콜 준수

## 1. SNAPSHOT (§4)

스왑 전 전체 백업 (2026-09-08T19:40 UTC):
`mission-20260909/N1_MASTER_DB_SNAPSHOT/MASTER_DB_BACKUP_2026-09-08T1940_*.{json,csv}`

| 탭 | 건수 |
|---|---|
| Products (구버전) | 60 |
| 남성 / 여성 / 젠더리스 | 각 20 |
| 백업_PRODUCTS_20260831 (이전 백업) | 61 |
| Product Media | 18 |

불변 탭(§3): Orders(184) · Orders_CS · Users · Refunds — **이번 미션에서 읽기 외 접근 0건**.
(CS 주문 컨텍스트 읽기 및 CS메모 기록은 기존 CS 기능의 정상 동작.)

## 2. STAGING (§5·§28)

- `MASTER_DB_NEXT_20260909` 탭 신설 — 44행 × 40컬럼
  (기존 29컬럼 + raw_name · trend_cluster_ids · selection_reason_internal · pair_ready ·
  primary_pair_id · pair_score · pair_reason · data_quality · audit_status · image_status · publish_ready)
- `Pairs` 탭 신설 — 20페어 (§47 pair record 스키마)
- READBACK 검증: 44행 · 상품ID 중복 0 · 필수값(상품명/공급사코드/판매가/raw_name) 결손 0

## 3. SWAP (§5)

- `백업_PRODUCTS_20260909` 탭에 구버전 60행 복사 (롤백 포인트)
- Products 탭(in-memory index 0 유지 — `sheetsByIndex[0]` API 계약) 데이터 행 교체 → 44행
- 남성 16 / 여성 16 / 젠더리스 12 뷰 탭 재구성 (기존 28컬럼 schema 유지)
- 라이브 Products 룩북이미지URL ← 공급사 제품컷 44/44 (image_status=SOURCE_ONLY)
- audit_status: PENDING_HERMES_REVIEW → **HERMES_APPROVED_20260909** (turn B 비준 후 갱신)

## 4. ROLLBACK 절차 (§4)

```bash
cd mission-20260909
node swap_master.cjs --rollback   # 백업_PRODUCTS_20260909(60행) → Products 복원
# 성별 뷰 탭은 스냅샷 JSON 기준 수동 복원 또는 현행 유지 (스토어프론트 미사용 탭)
```

롤백 후 검증: `node swap_master.cjs` 출력의 verify 라인에서 Products 60 rows / index=0 확인.

## 5. TRIPLE READBACK (§32)

| 계층 | 결과 |
|---|---|
| SHEET | Products 44행, index 0, 첫 행 PRD-N1-01 블랙 셔츠 |
| API | `/api/products` → ok:true, products 44 + pairs 17(BEST+SECONDARY), pair_score 미노출 확인 |
| FRONTEND | 브라우저 실측 — 히어로 "44 Pieces · 20 Outfits", 탭 카운트 44/16/16/12, "코디 17벌 · 단품 10개", 상의\|하의 헤더, 페어 row 렌더, 이미지 44/44 로드 (DOM complete·naturalWidth>0) |

불일치 0건 — rollback 가능 상태 유지 중.

## 6. DATA QUALITY GATE (§29)

전 상품(44): SOURCE 추적 ✓ · PRICE ✓ · CATEGORY ✓ · GENDER ✓ · TOP/BOTTOM ✓ ·
DUPLICATE ✓(canonical 0.6) · TREND LINK 42/44(2건 베이스 보완) · IMAGE STATUS ✓(SOURCE_ONLY).
MATERIAL/CARE/실측 = UNKNOWN (공급 페이지 JS 렌더링 — §22 UNKNOWN≠FACT 준수).
옵션별재고 미확정 → 구매 버튼 unconfirmed 정직 상태 (기존 게이트#2 — Owner 확정 필요).
