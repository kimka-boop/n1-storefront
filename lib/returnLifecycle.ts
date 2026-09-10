/**
 * N°1 RETURN LIFECYCLE (미션 §41–§47)
 *
 * - 반품·환불은 하나의 REFUNDED 불리언로 붕괴하지 않는다 — 11단계 라이프사이클.
 * - 상태 레코드는 app 소유 Return_Requests 시트. 주문 행은 canonical 파생 상태만.
 * - 승인(§43) ≠ 환불: 오너 [승인]은 RETURN_APPROVED까지이며, REFUND_READY →
 *   PaymentProvider.refundPayment() → provider 검증 → REFUNDED (§47) 경로만이
 *   환불을 만든다. 고객 요청·오너 승인 단독으로는 절대 환불이 아니다.
 * - 공급사 반품 어댑터가 없으면 RETURN_EXTERNAL_ACTION_REQUIRED + HERMES
 *   운영 태스크로 폴백한다 (§45) — 고객을 조용히 방치하지 않는다.
 */
import type { GoogleSpreadsheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { RETURN_REQUESTS_SHEET } from "@/lib/returnRequest";
import { findPaymentsByOrderId, updatePaymentRecord } from "@/lib/paymentRecords";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { emitHermesEvent } from "@/lib/hermesEvents";
import { dispatchOrderEmail } from "@/lib/transactionalEmail";
import { getOrdersSheet } from "@/lib/sheets";

// ── §41 상태 — 영문 토큰(코드) ↔ 시트 라벨(한글) ──────────────────────────────

export type ReturnLifecycleState =
  | "RETURN_REQUESTED"
  | "RETURN_REVIEW"
  | "RETURN_APPROVED"
  | "RETURN_EXTERNAL_ACTION_REQUIRED"
  | "RETURN_PICKUP_REQUESTED"
  | "RETURN_IN_TRANSIT"
  | "RETURN_RECEIVED"
  | "REFUND_READY"
  | "REFUND_PROCESSING"
  | "REFUNDED"
  | "RETURN_REJECTED";

export const RETURN_STATE_LABEL: Record<ReturnLifecycleState, string> = {
  RETURN_REQUESTED: "접수됨",
  RETURN_REVIEW: "검토중",
  RETURN_APPROVED: "승인",
  RETURN_EXTERNAL_ACTION_REQUIRED: "외부조치필요",
  RETURN_PICKUP_REQUESTED: "회수요청",
  RETURN_IN_TRANSIT: "회수중",
  RETURN_RECEIVED: "수령완료",
  REFUND_READY: "환불준비",
  REFUND_PROCESSING: "환불처리중",
  REFUNDED: "환불완료",
  RETURN_REJECTED: "거절",
};

const LABEL_TO_STATE = new Map(Object.entries(RETURN_STATE_LABEL).map(([k, v]) => [v, k as ReturnLifecycleState]));

export function stateFromLabel(label: string): ReturnLifecycleState | null {
  const v = (label || "").trim();
  if (LABEL_TO_STATE.has(v)) return LABEL_TO_STATE.get(v) as ReturnLifecycleState;
  // 레거시 "접수됨" 외 공란/기타 값은 접수로 간주하지 않는다 — 정직히 미지정
  return null;
}

/** §41 허용 전이 테이블 */
const ALLOWED_TRANSITIONS: Record<ReturnLifecycleState, ReturnLifecycleState[]> = {
  RETURN_REQUESTED: ["RETURN_REVIEW", "RETURN_APPROVED", "RETURN_REJECTED"],
  RETURN_REVIEW: ["RETURN_APPROVED", "RETURN_REJECTED"],
  RETURN_APPROVED: ["RETURN_EXTERNAL_ACTION_REQUIRED", "RETURN_PICKUP_REQUESTED"],
  RETURN_EXTERNAL_ACTION_REQUIRED: ["RETURN_PICKUP_REQUESTED", "RETURN_IN_TRANSIT"],
  RETURN_PICKUP_REQUESTED: ["RETURN_IN_TRANSIT"],
  RETURN_IN_TRANSIT: ["RETURN_RECEIVED"],
  RETURN_RECEIVED: ["REFUND_READY"],
  REFUND_READY: ["REFUND_PROCESSING"],
  REFUND_PROCESSING: ["REFUNDED"],
  REFUNDED: [],
  RETURN_REJECTED: [],
};

/** 각 상태가 기록되는 시각 컬럼 */
const STATE_TS_COLUMN: Partial<Record<ReturnLifecycleState, string>> = {
  RETURN_REQUESTED: "요청일시",
  RETURN_APPROVED: "승인일시",
  RETURN_PICKUP_REQUESTED: "회수요청일시",
  RETURN_IN_TRANSIT: "회수중일시",
  RETURN_RECEIVED: "수령일시",
  REFUND_READY: "환불준비일시",
  REFUND_PROCESSING: "환불처리일시",
  REFUNDED: "환불완료일시",
};

/** 라이프사이클 확장 컬럼 — Return_Requests 탭에 가산 보장 */
export const RETURN_LIFECYCLE_COLUMNS = [
  "승인일시", "거절사유", "회수요청일시", "반품택배사", "반품송장번호",
  "회수중일시", "수령일시", "환불준비일시", "환불처리일시", "환불완료일시",
  "환불금액", "공급사반품번호", "외부조치메모",
] as const;

export async function ensureReturnLifecycleColumns(doc: GoogleSpreadsheet): Promise<void> {
  let sheet = doc.sheetsByTitle[RETURN_REQUESTS_SHEET];
  if (!sheet) return; // 접수 경로가 먼저 탭을 만든다
  await sheet.loadHeaderRow(); // v5 — loadHeaderRow 없이 headerValues는 undefined
  const hv: string[] = sheet.headerValues || [];
  const missing = RETURN_LIFECYCLE_COLUMNS.filter((c) => !hv.includes(c));
  if (missing.length) await sheet.setHeaderRow([...hv, ...missing]);
}

// ── 전이 실행 ────────────────────────────────────────────────────────────────

export interface TransitionResult {
  ok: boolean;
  from?: ReturnLifecycleState | null;
  to?: ReturnLifecycleState;
  requestId?: string;
  error?: string;
  refund?: { executed: boolean; paymentId?: string; amount?: number; error?: string };
  externalFallback?: boolean;
}

export async function applyReturnTransition(
  openDoc: () => Promise<GoogleSpreadsheet>,
  requestId: string,
  to: ReturnLifecycleState,
  opts: { actor: string; memo?: string; returnCarrier?: string; returnTrackingNo?: string; refundAmount?: number } = { actor: "system" },
): Promise<TransitionResult> {
  try {
    const doc = await openDoc();
    await ensureReturnLifecycleColumns(doc);
    const sheet = doc.sheetsByTitle[RETURN_REQUESTS_SHEET];
    if (!sheet) return { ok: false, error: "Return_Requests 탭이 없습니다" };
    const rows = await sheet.getRows();
    const row = rows.find((r) => String(r.get("request_id") || "") === requestId);
    if (!row) return { ok: false, error: "반품 요청을 찾을 수 없습니다" };

    const from = stateFromLabel(String(row.get("상태") || ""));
    if (!from) return { ok: false, requestId, error: `현재 상태를 판독할 수 없습니다: ${row.get("상태")}` };
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      return { ok: false, requestId, from, to, error: `허용되지 않는 전이: ${from} → ${to}` };
    }

    const now = new Date().toISOString();
    row.set("상태", RETURN_STATE_LABEL[to]);
    const tsCol = STATE_TS_COLUMN[to];
    if (tsCol) row.set(tsCol, now);
    if (to === "RETURN_REJECTED" && opts.memo) row.set("거절사유", opts.memo.slice(0, 300));
    if (opts.returnCarrier) row.set("반품택배사", opts.returnCarrier);
    if (opts.returnTrackingNo) row.set("반품송장번호", opts.returnTrackingNo);
    if (opts.memo && to !== "RETURN_REJECTED") row.set("외부조치메모", opts.memo.slice(0, 300));

    const orderId = String(row.get("주문번호") || "");

    // §42–43 — 승인 기록 (환불 아님)
    if (to === "RETURN_APPROVED") {
      await emitHermesEvent(openDoc, {
        eventType: "RETURN_APPROVED",
        orderId,
        payload: { request_id: requestId, actor: opts.actor, test_only: orderId.startsWith("TEST-") },
      });
    }
    if (to === "RETURN_REJECTED") {
      await emitHermesEvent(openDoc, {
        eventType: "RETURN_REJECTED",
        orderId,
        payload: { request_id: requestId, actor: opts.actor },
      });
    }

    // §45 — 공급사 반품 어댑터 미연결 → 수동 폴백 (자동 기록, 고객 방치 없음)
    let externalFallback = false;
    if (to === "RETURN_APPROVED" || to === "RETURN_EXTERNAL_ACTION_REQUIRED") {
      const supplierAdapterConnected = false; // §44 — 실공급사 반품 API는 미연결 (정직 상수)
      if (!supplierAdapterConnected && to === "RETURN_APPROVED") {
        externalFallback = true;
        row.set("상태", RETURN_STATE_LABEL.RETURN_EXTERNAL_ACTION_REQUIRED);
        row.set(
          "외부조치메모",
          `[HERMES 운영 태스크] 공급사 반품 접수 필요 — 주문 ${orderId}, 요청 ${requestId}, 사유: ${String(row.get("사유") || "")}`.slice(0, 300),
        );
        await emitHermesEvent(openDoc, {
          eventType: "RETURN_EXTERNAL_ACTION_REQUIRED",
          orderId,
          payload: { request_id: requestId, reason: "supplier_return_adapter_not_connected" },
        });
      }
    }

    await row.save();

    // §47 — REFUND_PROCESSING에서 환불 실행. provider 검증 성공시에만 REFUNDED.
    let refund: TransitionResult["refund"];
    if (to === "REFUND_PROCESSING") {
      refund = await executeRefundForRequest(openDoc, row, requestId, opts.refundAmount);
      if (refund.executed) {
        // 환불 성공 → REFUNDED 확정 (같은 행 재로드 없이 직접 기록)
        row.set("상태", RETURN_STATE_LABEL.REFUNDED);
        row.set("환불완료일시", new Date().toISOString());
        if (typeof refund.amount === "number") row.set("환불금액", String(refund.amount));
        await row.save();
        await markOrderRefunded(openDoc, orderId);
        await emitHermesEvent(openDoc, { eventType: "REFUNDED", orderId, amount: refund.amount, payload: { request_id: requestId, test_only: orderId.startsWith("TEST-") } });
        const mail = await dispatchOrderEmail(doc, await loadOrderRecord(doc, orderId), "refund_completed", { refundAmount: refund.amount });
        if (!mail.sent && mail.status !== "skipped" && mail.status !== "no_email") {
          // 이메일 실패는 환불 진실을 바꾸지 않는다 (§24 원칙 준용)
        }
      }
    }

    if (to === "RETURN_RECEIVED") {
      await emitHermesEvent(openDoc, { eventType: "RETURN_RECEIVED", orderId, payload: { request_id: requestId } });
    }
    if (to === "REFUND_READY") {
      await emitHermesEvent(openDoc, { eventType: "REFUND_READY", orderId, payload: { request_id: requestId } });
    }

    return { ok: true, from, to, requestId, refund, externalFallback };
  } catch (e) {
    return { ok: false, requestId, error: (e as Error).message };
  }
}

// ── §47 환불 실행 — provider 경계 ─────────────────────────────────────────────

async function executeRefundForRequest(
  openDoc: () => Promise<GoogleSpreadsheet>,
  row: GoogleSpreadsheetRow,
  requestId: string,
  overrideAmount?: number,
): Promise<NonNullable<TransitionResult["refund"]>> {
  const orderId = String(row.get("주문번호") || "");
  const doc = await openDoc();
  const { provider } = resolvePaymentProvider();
  // 환불 대상 = 이 주문의 CONFIRMED 결제 레코드 (가장 최근 요청순)
  const records = await findPaymentsByOrderId(doc, orderId);
  const open = records.find((r) => r.status === "CONFIRMED") ?? null;
  if (!open) {
    return { executed: false, error: "환불할 CONFIRMED 결제 레코드가 없습니다" };
  }
  if (open.status !== "CONFIRMED") {
    return { executed: false, paymentId: open.paymentId, error: `결제 상태가 CONFIRMED가 아닙니다 (${open.status})` };
  }
  const amount = overrideAmount ?? open.confirmedAmount ?? open.requestedAmount;
  // §1 PRODUCTION FREEZE — live provider가 생기는 날에도 이 호출은 provider가 검증한다.
  const result = await provider.refundPayment({
    payment_id: open.paymentId,
    provider_payment_id: open.providerPaymentId,
    amount,
    reason: `return ${requestId}`,
  });
  if (!result.ok) {
    await updatePaymentRecord(doc, open.paymentId, {
      status: "REFUND_FAILED",
      failureCode: "REFUND_EXECUTION_FAILED",
      failureMessage: result.failure_code || "provider refund refused",
    });
    return { executed: false, paymentId: open.paymentId, error: "provider가 환불을 거절했습니다" };
  }
  // payment record: REFUNDED 상태 + cancelled_at(=refund_at 근거 컬럼 재사용)
  await updatePaymentRecord(doc, open.paymentId, {
    status: "REFUNDED",
    cancelledAt: new Date().toISOString(),
  });
  return { executed: true, paymentId: open.paymentId, amount };
}

async function markOrderRefunded(openDoc: () => Promise<GoogleSpreadsheet>, orderId: string): Promise<void> {
  try {
    const doc = await openDoc();
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return;
    const rows = await sheet.getRows();
    const row = rows.find((r) => String(r.get("주문번호") || "") === orderId);
    if (!row) return;
    row.set("결제상태", "환불완료"); // toCanonicalStatus → REFUNDED (§39 파생 단일 진실)
    await row.save();
  } catch {
    // 주문 행 갱신 실패도 환불 레코드 진실을 바꾸지 않는다 — 이벤트 기록이 증거
  }
}

async function loadOrderRecord(doc: GoogleSpreadsheet, orderId: string) {
  const sheet = await getOrdersSheet(doc);
  const rows = sheet ? await sheet.getRows() : [];
  const row = rows.find((r) => String(r.get("주문번호") || "") === orderId);
  const get = (c: string) => String(row?.get(c) ?? "");
  return {
    orderId,
    orderTime: get("주문일시"),
    paymentMethod: get("결제수단"),
    paymentStatus: get("결제상태"),
    depositor: get("입금자명"),
    customerName: get("고객명"),
    customerPhone: get("연락처"),
    customerAddress: get("배송지"),
    customerId: get("고객ID"),
    itemsJson: get("주문항목"),
    total: Number(get("총결제금액").replace(/[^\d]/g, "")) || 0,
    shipType: get("배송유형"),
    shipStatus: get("배송상태"),
    carrier: get("택배사"),
    trackingNo: get("송장번호"),
    csMemo: get("CS메모"),
    raw: row ? Object.fromEntries((sheet!.headerValues || []).map((h) => [h, get(h)])) : {},
  };
}

export type { TransitionResult as ReturnTransitionResult };
