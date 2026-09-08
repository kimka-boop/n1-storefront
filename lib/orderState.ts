/**
 * N°1 Order State Machine — 주문 상태 단일 계약 (Session C, 미션 §6)
 *
 * - canonical 상태 집합 + 유일한 전이 테이블(canTransition) — Session I(반품 플로우)와
 *   Session H(체크아웃 연결)이 이 모듈만 import 하면 상태 해석이 일치한다.
 * - 기존 Orders 시트의 결재상태/배송상태 한글 문자열(입금대기/결제완료/접수/배송완료 …)과
 *   harmonize: toCanonicalStatus() 로 레거시 → canonical 읽기, displayLabel() 로 표시.
 *   시트 컬럼 구조는 그대로 — 운영자 기존 갱신 흐름을 깨지 않는다 (읽기 계약만 추가).
 * - 클라이언트는 절대 PAID 이상으로 상태를 쓸 수 없다. PAID 전이는 서버 검증 후에만.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAID",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** canonical → 고객 표시 라벨 (기존 UI 문구와 정합) */
const STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "임시 주문",
  PAYMENT_PENDING: "입금 대기",
  PAID: "결제 완료",
  PREPARING: "상품 준비 중",
  SHIPPED: "배송 중",
  DELIVERED: "배송 완료",
  CANCEL_REQUESTED: "취소 요청",
  CANCELLED: "취소 완료",
  RETURN_REQUESTED: "반품 요청",
  REFUND_PENDING: "환불 처리 중",
  REFUNDED: "환불 완료",
};

export function displayLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * 허용된 전이 테이블 — 여기 없는 전이는 전부 금지.
 * - CANCEL_REQUESTED → PAID/PREPARING: 운영자가 요청을 반려하고 이어서 처리 (복귀)
 * - RETURN_REQUESTED → DELIVERED: 반품 요청 반려 → 배송완료 복귀
 * - CANCELLED / REFUNDED: 종단 상태 (전이 없음)
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCEL_REQUESTED", "CANCELLED"],
  PAID: ["PREPARING", "CANCEL_REQUESTED", "CANCELLED", "REFUND_PENDING"],
  PREPARING: ["SHIPPED", "CANCEL_REQUESTED", "CANCELLED", "REFUND_PENDING"],
  SHIPPED: ["DELIVERED", "RETURN_REQUESTED"],
  DELIVERED: ["RETURN_REQUESTED"],
  CANCEL_REQUESTED: ["CANCELLED", "PAID", "PREPARING"],
  CANCELLED: [],
  RETURN_REQUESTED: ["REFUND_PENDING", "DELIVERED"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status]?.length === 0;
}

/** Session H/I 가 상태를 쓰기 전 강제하는 가드 — 위반 시 throw (호출자가 4xx 매핑) */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`주문 상태 전이 불가: ${from} → ${to}`);
  }
}

function normalize(s: string): string {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

/** 배송상태(레거시) 한글 → 진행 단계 힌트 */
function shipStage(shipStatus: string): "none" | "prep" | "transit" | "done" {
  const v = normalize(shipStatus);
  if (!v) return "none";
  if (v.includes("완료")) return "done"; // 배송완료
  if (v.includes("배송중") || v.includes("발송") || v.includes("출고") || v.includes("배송시작"))
    return "transit";
  if (v.includes("접수") || v.includes("준비")) return "prep";
  return "none";
}

export interface LegacyStatusPair {
  paymentStatus?: string; // Orders.결제상태 — "입금대기" | "입금확인중" | "결제완료" | "결제취소" | "환불" …
  shipStatus?: string; // Orders.배송상태 — "접수" | "출고준비중" | "배송중" | "배송완료" …
}

/**
 * 레거시 (결제상태, 배송상태) 쌍 → canonical 1개.
 * 우선순위: 취소/반품/환불 키워드 > 결제 미완료 > 결제완료(배송단계로 세분화).
 */
export function toCanonicalStatus(pair: LegacyStatusPair): OrderStatus {
  const pay = normalize(pair.paymentStatus || "");
  const ship = shipStage(pair.shipStatus || "");

  if (pay.includes("취소")) return "CANCELLED";
  if (pay.includes("반품")) return "RETURN_REQUESTED";
  if (pay.includes("환불")) {
    if (pay.includes("완료")) return "REFUNDED";
    return "REFUND_PENDING";
  }
  // 결제 완료 신호가 없는 구간 (V1: 입금대기/입금확인중/빈값)
  if (
    !pay ||
    pay.includes("대기") ||
    pay.includes("미입금") ||
    pay.includes("확인중") ||
    pay.includes("요청")
  ) {
    // CS메모에만 존재하는 '입금확인요청'도 아직 입금대기 — 운영자 확인 전까지
    return pay.includes("임시") || pay.includes("draft") ? "DRAFT" : "PAYMENT_PENDING";
  }
  // 결제완료 이후 — 배송 단계가 상태를 결정
  if (ship === "done") return "DELIVERED";
  if (ship === "transit") return "SHIPPED";
  if (ship === "prep") return "PREPARING";
  return "PAID";
}

/**
 * 주문 레코드(시트 2열 + CS메모) 읽기 — 반품/취소 요청이 CS메모에만 있는 경우까지 반영.
 * Session I 가 반품 플로우 상태 판독에 재사용한다.
 */
export function readOrderStatus(record: {
  paymentStatus?: string;
  shipStatus?: string;
  csMemo?: string;
}): OrderStatus {
  const memo = record.csMemo || "";
  const canonical = toCanonicalStatus({
    paymentStatus: record.paymentStatus,
    shipStatus: record.shipStatus,
  });
  // 반품/취소 요청은 CS메모 태그로 운영자 기록 가능 — 종결 상태가 아니면 요청 상태 우선 표시
  const asked = memo.includes("반품요청")
    ? "RETURN_REQUESTED"
    : memo.includes("취소요청")
      ? "CANCEL_REQUESTED"
      : null;
  if (asked) {
    const finished =
      canonical === "CANCELLED" ||
      canonical === "REFUNDED" ||
      canonical === "REFUND_PENDING";
    if (!finished) return asked;
  }
  return canonical;
}
