/**
 * N°1 HERMES Operations Events — 운영 이벤트 발행 계층 (미션 §2 캐노니컬 플로우)
 *
 * 커머스 코어의 중요 전이(주문 draft, 결제 요청/검증/확정/실패)를 HERMES 운영 계층이
 * 질의할 수 있는 이벤트 레코드로 남긴다. 발송 계층이 아니라 **기록** 계층이다:
 * - Telegram(봇2 = N1 결제발주센터) 알림과 병행된다 — 봇은 운영자의 눈, 이벤트 시트는 시스템의 기억.
 * - best-effort: 시트 실패가 고객 주문·결제 흐름을 절대 막지 않는다(실패는 콘솔 로그만).
 * - 민감 데이터 없음: 고객명·연락처·주소는 payload에 넣지 않는다(주문번호 참조만).
 */

export const HERMES_EVENTS_SHEET = "HERMES_Events";

export const HERMES_EVENT_HEADERS = [
  "event_id",
  "event_type",
  "order_id",
  "payment_id",
  "provider",
  "amount",
  "currency",
  "payload",
  "created_at",
];

export type HermesEventType =
  | "ORDER_DRAFTED"
  | "PAYMENT_REQUESTED"
  | "PAYMENT_REQUEST_FAILED"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  // ── Master Acceptance §20–§47 — 주문 라이프사이클 확장 이벤트 ──
  | "SUPPLIER_ORDER_DRYRUN" // §67–68 — TestSupplierAdapter 발주 기록 (TEST_ONLY)
  | "SHIPMENT_STARTED" // §23 — 첫 운송장 출현
  | "DELIVERED_CONFIRMED" // §25 — 최종 고객 수령 확인
  | "ORDER_CANCEL_REQUESTED" // §40 — 배송준비 단계 취소 요청
  | "ORDER_CANCELLED" // §40 — 취소 확정
  | "RETURN_REQUESTED" // §41 — 반품 접수
  | "RETURN_APPROVED" // §42–43 — 오너 승인 (환불 아님)
  | "RETURN_REJECTED"
  | "RETURN_EXTERNAL_ACTION_REQUIRED" // §45 — 공급사 반품 어댑터 미연결 수동 폴백
  | "RETURN_RECEIVED"
  | "REFUND_READY"
  | "REFUNDED"; // §47 — 환불 실행 완료 (provider 검증 후)

export interface HermesOrderEvent {
  eventType: HermesEventType;
  orderId: string;
  paymentId?: string;
  provider?: string;
  amount?: number;
  currency?: string;
  /** 민감 데이터 금지 — 코드·사유·참조 등 안전 필드만 */
  payload?: Record<string, string | number | boolean | null>;
}

export function makeHermesEventPayload(
  e: HermesOrderEvent,
): Record<string, string> {
  return {
    event_id: `EVT-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    event_type: e.eventType,
    order_id: e.orderId,
    payment_id: e.paymentId || "",
    provider: e.provider || "",
    amount: typeof e.amount === "number" ? String(e.amount) : "",
    currency: e.currency || (e.amount !== undefined ? "KRW" : ""),
    payload: e.payload ? JSON.stringify(e.payload) : "",
    created_at: new Date().toISOString(),
  };
}

/**
 * 이벤트 기록 (best-effort).
 * GoogleSpreadsheet를 직접 받지 않고 opener를 받는다 — 이벤트 기록 실패가
 * 이미 진행 중인 주문 트랜잭션에 getDoc 재시도 비용을 물리지 않기 위함.
 */
export async function emitHermesEvent(
  openDoc: () => Promise<import("google-spreadsheet").GoogleSpreadsheet>,
  e: HermesOrderEvent,
): Promise<boolean> {
  try {
    const doc = await openDoc();
    let sheet = doc.sheetsByTitle[HERMES_EVENTS_SHEET];
    if (!sheet) {
      sheet = await doc.addSheet({ title: HERMES_EVENTS_SHEET, headerValues: HERMES_EVENT_HEADERS });
    }
    await sheet.addRow(makeHermesEventPayload(e));
    return true;
  } catch (err) {
    console.warn(
      `[hermesEvents] 이벤트 미기록 (운영 흐름은 계속): ${e.eventType} ${e.orderId}`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
