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
