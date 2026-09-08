# N1_PG_INTEGRATION_HANDOFF

N°1 Commerce V1 → PG 결제 연동 인계 문서 (SESSION C 작성, 2026-09-09)
브랜치: `n1-commerce-cs-v1` · 기준: 현재 무통장입금 V1 플로우

---

## 1. 현재 상태 (V1)

- 결제수단: **무통장입금 단일** (`lib/payments.ts` `DEFAULT_PAYMENT_METHOD`)
- 주문 생성: `POST /api/orders` — 서버가 가격·재고 재검증 후 Orders 시트 인입,
  `결제상태=입금대기`, 이 시점에 재고 차감 + 봇2(Telegram) 신규 주문 알림
- 입금 확인 요청: `POST /api/orders/confirm` — CS메모 기록 + 봇2 알림.
  **결제상태는 운영자(디렉터)가 대장 확인 후 수동 갱신** (클라이언트 요청으로 완료 처리 불가)
- UI: `/checkout` 4단계(상품 확인 → 주문자/배송 → 결제 정보 → 최종 검토) →
  `/checkout/payment`(계좌 안내) → `/checkout/pending`(확인 대기)
- PG는 UI에서 "결제 시스템 연결 준비 중" 비활성 표시 (`lib/payments.ts` `pg_card`).
  fake payment success는 어디에도 없다.

## 2. PG 연동 시 교체 지점 (설계된 contract)

개념 흐름 (미션 §10–§11):

```
createOrderDraft()      → POST /api/orders  (금액·품목 서버 확정, status=입금대기→결제대기)
createPaymentRequest()  → PG Provider 호출 (결제창 URL / 위젯 파라미터)
   (신규) PG redirect/widget — 클라이언트는 결제창만 연다
verifyPayment()         → 서버가 PG에 거래 검증 (webhook 수신 또는 조회 API)
confirmOrder()          → 검증 성공 시에만 결제상태=결제완료 + 재고 차감 + 봇2 알림
```

파일별 변경점:

| 위치 | 변경 |
| --- | --- |
| `lib/payments.ts` | `pg_card.available = true`, provider 메타(토스페이먼츠 등) 추가 |
| `components/CheckoutFlow.tsx` | `submitOrder`: 무통장 분기 → PG 분기 추가. PG 선택 시 `createPaymentRequest` 응답의 결제창으로 이동, 성공 콜백에서 `/checkout/payment` 대신 완료 페이지로 |
| `app/api/orders/route.ts` | `payment_method` 값을 클라이언트에서 받아 화이트리스트 검증 후 기록 (현재는 상수 고정). PG 주문은 **재고 차감을 결제 검증 후로 이연**하거나 PG용 draft 상태 유지 |
| (신규) `app/api/payments/webhook/route.ts` | PG webhook 수신 → `verifyPayment` → `confirmOrder`. idempotency 키로 중복 확정 방지 |
| Orders 시트 | `PG거래ID` 컬럼 이미 존재 — 거래ID 기록에 사용. `결제상태` 값 집합에 `결제완료/취소/환불` 추가 |

## 3. 유지해야 할 보안 원칙 (이미 적용됨, PG 후에도 동일)

- 클라이언트 금액·상품가격 신뢰 금지 — 서버 재계산 (`/api/orders` 2단계)
- 클라이언트 "결제완료" 신호만으로 주문 확정 금지 — 서버↔PG 검증 필수
- 카드번호 등 결제 민감정보는 서버 저장 금지 (PG 위젯/iframe 위임)
- webhook idempotency (PG거래ID 유니크 처리) + 중복 confirmation 방지
- 시크릿은 env로만 (`N1_PG_*` 네이밍 권장), frontend bundle 노출 금지

## 4. 무통장입금의 PG 후 위치

무통장입금은 V1의 실제 결제수단이므로 PG 연동 후에도 유지 권장(가상계좌는 PG사 제공으로 전환 가능).
`PAYMENT_METHODS` 배열에 그대로 두면 UI 분기는 자동 처리된다.
