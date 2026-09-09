/**
 * N°1 Payment State Machine — 결제 상태 단일 계약 (Commerce Architecture Mission, §4)
 *
 * 주문(lib/orderState)과 결제는 별개 엔티티다. 주문이 PAID가 되는 유일한 경로는
 * 결제 레코드가 CONFIRMED로 검증되는 것이고, 그 반대도 결제가 주문을 만들지 않는다.
 *
 * - 저장 위치: PG(카드/간편결제) 결제는 Payments 시트 레코드가 단일 진실.
 *   무통장입금 V1은 Orders.결제상태 문자열이 단일 진실(운영자 수동 갱신 계약 유지)이며,
 *   이 모듈의 derivePaymentState() 로 같은 상태 언어로 읽어온다 (매핑 계약 — 이중 진실 방지).
 * - 카드번호·CVV 등 민감 카드 데이터는 어떤 상태 전이에서도 저장되지 않는다 (미션 §5) —
 *   결제 레코드가 담는 것은 PG가 돌려준 안전 메타데이터뿐이다.
 */

export const PAYMENT_STATUSES = [
  "CREATED",
  "PENDING",
  "AUTHORIZED",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** canonical → 운영/고객 표시 라벨 */
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  CREATED: "결제 요청 생성",
  PENDING: "결제 대기",
  AUTHORIZED: "가승인",
  CONFIRMED: "결제 완료",
  FAILED: "결제 실패",
  CANCELLED: "결제 취소",
  REFUND_PENDING: "환불 처리 중",
  REFUNDED: "환불 완료",
};

export function paymentLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status] ?? status;
}

/**
 * 허용된 전이 테이블 — 여기 없는 전이는 전부 금지.
 * - CREATED → PENDING: PG 요청 발급 성공 (발급 실패는 FAILED)
 * - FAILED / CANCELLED: 종단. 재시도는 같은 레코드를 되살리지 않고 **새 결제 레코드**로 한다
 *   (한 레코드 = 한 번의 결제 시도 — 감사 추적 단순화).
 * - AUTHORIZED → REFUND_PENDING: 가승인 상태에서도 취소·환불 가능.
 * - CONFIRMED → REFUND_PENDING: 정산 후 환불의 유일한 출구.
 */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ["PENDING", "AUTHORIZED", "FAILED", "CANCELLED"],
  PENDING: ["AUTHORIZED", "CONFIRMED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["CONFIRMED", "FAILED", "CANCELLED", "REFUND_PENDING"],
  CONFIRMED: ["REFUND_PENDING"],
  FAILED: [],
  CANCELLED: [],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export function paymentCanTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

export function paymentIsTerminal(status: PaymentStatus): boolean {
  return (PAYMENT_TRANSITIONS[status] ?? []).length === 0;
}

/** 위반 시 throw — 호출자(라우트/플로우)가 오류를 기록하고 요청을 거절한다 */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!paymentCanTransition(from, to)) {
    throw new Error(`결제 상태 전이 불가: ${from} → ${to}`);
  }
}

// ── 무통장입금 V1: Orders.결제상태 문자열 → 결제 상태 (읽기 계약 — 쓰기는 운영자) ──

function normalize(s: string): string {
  return (s || "").replace(/\s+/g, "");
}

/**
 * 레거시 결제상태 한글 문자열 → PaymentStatus.
 * lib/orderState.toCanonicalStatus 와 같은 어휘를 읽지만, 주문 진행(배송)은 결합하지 않는다 —
 * 결제 상태는 결제만 본다.
 */
export function derivePaymentState(legacyPaymentStatus: string): PaymentStatus {
  const v = normalize(legacyPaymentStatus);
  if (v.includes("환불완료")) return "REFUNDED";
  if (v.includes("환불")) return "REFUND_PENDING";
  if (v.includes("취소")) return "CANCELLED";
  if (v.includes("실패")) return "FAILED";
  if (v.includes("완료")) return "CONFIRMED";
  // 입금대기 / 입금확인중 / 결제대기 / 환불(진행) / 빈값 — 아직 결제 확정이 아닌 구간
  return "PENDING";
}

/** 결제 레코드 공개 필드 — status 라우트가 내려가는 안전 투영 (PII·시크릿 0) */
export interface PublicPaymentView {
  payment_id: string;
  provider: string;
  method: string;
  status: PaymentStatus;
  status_label: string;
  amount: number;
  currency: string;
}
