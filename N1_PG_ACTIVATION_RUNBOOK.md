# N1_PG_ACTIVATION_RUNBOOK

> **N°1 결제 활성화 절차** — Commerce Architecture Mission (2026-09-10)
> 목적: 승인된 PG 공급자 연결 + 프로덕션 키 주입 + 라이브 결제 활성화가
> 이 시스템에서 **유일하게 남은 외부 단계**가 되도록 하는 것.
> 아키텍처 상세: `N1_COMMERCE_BASELINE_AUDIT.md` · `N1_FINAL_COMMERCE_ARCHITECTURE_REPORT.md`

---

## 0. 원칙 (절대 불변)

1. **활성화는 Human Owner 승인 사항이다** — 유료 API·실제 결제는 HERMES 승인 게이트
   ([PAID]/[APPROVAL] → blocked) 대상. 워커·에이전트가 자동 승격하지 않는다.
2. **카드 데이터는 서버를 경유하지 않는다** — PG 위젯/iframe/결제창 위임. 서버는 PG가
   돌려준 안전 메타데이터만 저장한다 (Payments 시트에 카드 필드 자체가 없다).
3. **클라이언트 신호로 주문 확정 금지** — PAID 전이는 서버가 PG를 직접 조회해
   CONFIRMED를 받았을 때만 (`lib/paymentFlow.settleOnce`).
4. **시크릿은 env로만** — `N1_PG_*` 네이밍, 소스·시트·로그에 값 기록 금지.

---

## 1. 현재 상태 (pre-PG)

- `N1_PG_PROVIDER` 미설정 → `resolvePaymentProvider()` 가 `no_live_pg` 어댑터만 돌려준다.
- UI: `/checkout` 결제수단에서 **카드·간편결제 = "결제 시스템 연결 준비 중" 비활성**.
- 서버: `pg_card` 주문 시도는 시트 쓰기 이전에
  `503 { code: "PAYMENT_PROVIDER_NOT_CONFIGURED", error: "결제 시스템 준비 중입니다." }` 로 정직 거절.
- 무통장입금 V1 플로우는 그대로 운영된다 (운영자 대장 확인 = 검증 계약).

## 2. 활성화 절차 (순서대로)

### Step 1 — 어댑터 구현 (코드 리뷰 필요)

`lib/paymentProvider.ts`의 `PaymentProvider` 계약을 구현하는 어댑터를 추가한다:

```
lib/payment/
  provider.ts        # 계약 재수출 (이미 있음 — lib/paymentProvider.ts)
  toss.ts            # 예: 토스페이먼츠 어댑터 (선택된 PG만 구현)
```

계약 (전부 구현 필수):

| 메서드 | 요구 |
|---|---|
| `verifyWebhookSignature(headers, rawBody)` | PG별 서명 계약 구현. 불일치 = false (webhook 폐기) |
| `createPaymentRequest(order)` | 결제창 URL/위젯 파라미터 발급. 금액은 서버가 계산한 값만 사용 |
| `verifyPayment(ref)` | **서버→PG 직접 조회**. webhook 본문의 금액·상태를 신뢰하지 않는다 |
| `cancelPayment` / `refundPayment` / `getPaymentStatus` | 운영 취소·환불·조회 |

구현 규칙:
- 시크릿은 `process.env.N1_PG_SECRET_KEY` 등 env만 읽는다. 값을 반환·로깅 금지.
- SSRF 가드: PG API 엔드포인트는 고정 호스트 상수(https)로 — 요청 URL을 body로부터 조립 금지
  (lib/telegram.ts의 ALLOWED_HOST 패턴 준수).
- `resolvePaymentProvider()`에 어댑터 분기 추가 + `configSummary` 갱신.

### Step 2 — UI 스위치 (1줄)

`lib/payments.ts`의 `pg_card.available` → `true` + `description` 갱신.
(이 스위치가 꺼져 있으면 어댑터가 살아 있어도 고객은 PG를 선택할 수 없다 — fail-closed.)

### Step 3 — env 주입 (배포 호스트)

```
N1_PG_PROVIDER=toss                      # 어댑터 식별자
N1_PG_SECRET_KEY=<PG 시크릿>              # 어댑터가 읽는 키
N1_PG_WEBHOOK_SECRET=<웹훅 서명 검증용>    # 어댑터 verifyWebhookSignature가 대조
```

주의: `N1_PG_TEST_ONLY=true` 는 **절대 프로덕션에 설정 금지** — 합성 PG가 활성화되고
주문번호가 TEST- 네임스페이스로 바뀐다.

### Step 4 — webhook 등록

PG 관리자 콘솔에 webhook 엔드포인트 등록:

```
https://<도메인>/api/payments/webhook
```

- 서버는 `verifyWebhookSignature` 로 검증 후 처리한다 (미검증 webhook = 401 폐기).
- 재전송 정책: PG 재도착은 멱등 처리된다(동시 도착 병합 + 결제 레코드 상태 방어).

### Step 5 — 검증 (순서 엄수)

1. **단위/통합**: `node --test tests/*.test.cjs` 전부 PASS (205+).
2. **격리 E2E** (운영 시트 무영향):
   ```
   node ops/payment_e2e.cjs setup                       # 테스트 문서 생성 → SHEET_ID
   N1_SHEET_ID=<SHEET_ID> N1_PG_PROVIDER=test N1_PG_TEST_ONLY=true npx next start -p 3445
   node ops/payment_e2e.cjs verify http://localhost:3445 <SHEET_ID>
   ```
   → 무통장 draft, pg_card 요청→정산→webhook 검증→주문 확정, 지연 차감,
   Payments/HERMES_Events 기록, 부정 경로까지 자동 검증. **E2E PASS 없으면 다음 단계 금지.**
3. **프로덕션 헌금성 스모크**: 실배포에서 `pg_card` 미사용 상태로 무통장 주문 1건
   생성→운영자 확인 플로우 재확인.
4. **소액 실거래 1건** (Owner 승인 하): 실카드 결제 → Orders 결제완료 + PG거래ID +
   결제발주센터(봇2) "✅ 결제 완료" 알림 + Stock_Staging 차감 확인 → 즉시 운영 취소.

### Step 6 — 운영 관측

- HERMES: `HERMES_Events` 시트에 ORDER_DRAFTED / PAYMENT_REQUESTED / PAYMENT_CONFIRMED /
  PAYMENT_FAILED 이벤트 적재 (민감 데이터 없음 — 주문번호 참조만).
- 봇2(N1 결제발주센터): PG 결제 확정 시 "✅ N°1 결제 완료 … 발주 진행해주세요" 알림.
- 실패 추적: Payments 시트 failure_code / failure_message (AMOUNT_MISMATCH 등).

## 3. 롤백

`N1_PG_PROVIDER` 삭제 + `pg_card.available=false` → 즉시 pre-PG 상태로 복귀
(503 정직 거절). 진행 중이던 PG 주문만: webhook 수동 재검증 또는 PG 관리자 취소.
Orders 시트는 주문의 단일 진실이므로 상태 수동 갱신이 최종 수단이다.

## 4. 보안 체크리스트 (활성화 전 전부 확인)

- [ ] 어댑터에 시크릿 리터럴 0 (소스·테스트·예시 전부)
- [ ] verifyWebhookSignature 미검증 webhook 폐기 확인
- [ ] verifyPayment가 PG 조회로 금액 대조 — AMOUNT_MISMATCH 시 확정 거부 확인
- [ ] 카드 데이터가 서버 로그·시트·응답 어디에도 없음 확인
- [ ] `N1_PG_TEST_ONLY` 미설정 확인 (프로덕션)
- [ ] L4(오류 위생)·전체 테스트 스위트 PASS
