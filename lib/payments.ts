/**
 * N°1 Payment — 결제 수단 계약 (PG-ready boundary, 미션 §10·§49)
 *
 * V1: 무통장입금만 실제 사용 가능. PG(카드/간편결제)는 제공자 미연결 상태이며
 *     fake payment success를 만들지 않는다 — UI에서는 정확히 "준비 중"으로 표시.
 *
 * PG 도입 시 교체 지점 (N1_PG_INTEGRATION_HANDOFF.md 참조):
 *   createOrderDraft()      → POST /api/orders (결제수단·금액 서버 확정, status=결제대기)
 *   createPaymentRequest()  → PG Provider 호출 (결제창/redirect URL 발급)
 *   verifyPayment()         → 서버가 PG에 거래 검증 (webhook 또는 조회)
 *   confirmOrder()          → 검증 성공 시에만 주문 확정 (재고 차감은 기존 인입 로직)
 *   클라이언트 "결제완료" 신호만으로 주문 확정 금지.
 */

export type PaymentMethodId = "bank_transfer" | "pg_card";

export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "bank_transfer",
    name: "무통장입금",
    description: "주문 후 안내된 계좌로 입금 — 입금 확인 후 출고됩니다.",
    available: true,
  },
  {
    id: "pg_card",
    name: "카드 · 간편결제",
    description: "PG 제공자 연동 후 활성화됩니다.",
    available: false,
    unavailableReason: "결제 시스템 연결 준비 중",
  },
];

export function getPaymentMethods(): PaymentMethod[] {
  return PAYMENT_METHODS;
}

export function findPaymentMethod(id: string): PaymentMethod | undefined {
  return PAYMENT_METHODS.find((m) => m.id === id);
}

/** 서버가 신뢰하는 유일한 V1 결제수단 — 클라이언트가 다른 값을 보내도 이 값으로 기록 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethodId = "bank_transfer";

// ── 서버 결제수단 결정 (Commerce Architecture Mission §13E·§17) ──
// 클라이언트의 결제수단 선택은 "요청"일 뿐이다. 서버가 어댑터 상태를 보고 결정한다.

export const PAYMENT_METHOD_UNSUPPORTED = "PAYMENT_METHOD_UNSUPPORTED";
export const CUSTOMER_MSG_PG_PREPARING = "결제 시스템 준비 중입니다.";

export type ServerPaymentDecision =
  | { ok: true; method: PaymentMethodId }
  | { ok: false; code: string; customer_message: string };

/**
 * 요청된 결제수단 → 서버가 실제로 수행할 결제수단.
 * - 미지정 → 무통장입금 (V1 기본, 하위호환)
 * - pg_card → live PG 어댑터가 있을 때만 수용. 없으면 PAYMENT_PROVIDER_NOT_CONFIGURED 로
 *   정직 거절 — 거짓 결제수단으로 주문을 만들지 않는다 (미션 §17).
 */
export function resolveServerPaymentMethod(
  requested: string | undefined,
  livePgAvailable: boolean,
): ServerPaymentDecision {
  const req = String(requested || "").trim() || DEFAULT_PAYMENT_METHOD;
  if (req === "bank_transfer") return { ok: true, method: "bank_transfer" };
  if (req === "pg_card") {
    return livePgAvailable
      ? { ok: true, method: "pg_card" }
      : { ok: false, code: PAYMENT_PROVIDER_NOT_CONFIGURED_CODE, customer_message: CUSTOMER_MSG_PG_PREPARING };
  }
  return { ok: false, code: PAYMENT_METHOD_UNSUPPORTED, customer_message: "지원하지 않는 결제 수단입니다." };
}

/** paymentProvider 모듈을 클라이언트 번들이 가져가지 않도록 코드 상수만 로컬 정의 */
export const PAYMENT_PROVIDER_NOT_CONFIGURED_CODE = "PAYMENT_PROVIDER_NOT_CONFIGURED";
