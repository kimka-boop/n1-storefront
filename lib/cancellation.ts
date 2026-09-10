/**
 * N°1 CANCELLATION (미션 §39–§40·§53)
 *
 * 취소 ≠ 반품. 배송 단계별로 정직하게 라우팅한다:
 *   배송준비(PAID/PREPARING 이하) → 주문 취소 검토 (CANCEL_REQUESTED)
 *   배송중(SHIPPED)              → 반품·중단 (RETURN 경계 — 자동 취소 없음)
 *   배송완료(DELIVERED)           → 반품·환불 (RETURN 경계)
 *
 * 요청(request)은 상태 태그(CS메모) + Return_Requests 기록 + 운영 이벤트로 남기고,
 * 확정(confirm)은 오너/운영 검증 이후에만 — 인간 텍스트가 상태를 함부로 바꾸지
 * 않는다 (§53). 취소 확정 시 취소 확인 이메일을 멱등 발송한다 (§54).
 */
import type { GoogleSpreadsheet } from "google-spreadsheet";
import { findOrderById, getOrdersSheet } from "@/lib/sheets";
import { readOrderStatus, type OrderStatus } from "@/lib/orderState";
import { emitHermesEvent } from "@/lib/hermesEvents";
import { dispatchOrderEmail } from "@/lib/transactionalEmail";

export interface CancelResolution {
  ok: boolean;
  status: number;
  process?: "CANCELLATION" | "RETURN_INTERCEPTION" | "RETURN_REFUND";
  order_status?: OrderStatus;
  message?: string;
  windowLabel?: string | null;
  code?: string;
}

export interface CancelOwnership {
  /** 회원 세션 이메일 (서버 세션에서 검증된 값) */
  memberEmail?: string;
  /** 게스트 — 주문 연락처 전체 일치 */
  guestPhone?: string;
}

export function resolveOwnership(
  record: { customerId: string; customerPhone: string; raw: Record<string, string> },
  o: CancelOwnership,
): "member" | "guest" | null {
  const orderEmail = String(record.raw?.["고객이메일"] || "").trim().toLowerCase();
  const phone = String(record.customerPhone || "").replace(/\D/g, "");
  if (o.memberEmail && orderEmail && orderEmail === o.memberEmail.trim().toLowerCase()) return "member";
  if (o.guestPhone && phone && phone === String(o.guestPhone).replace(/\D/g, "")) return "guest";
  return null;
}

async function appendCsMemo(doc: GoogleSpreadsheet, orderId: string, tag: string): Promise<boolean> {
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return false;
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("주문번호") || "") === orderId);
  if (!row) return false;
  const memo = String(row.get("CS메모") || "").trim();
  if (memo.includes(tag)) return true; // 이미 기록 — 중복 태그 없음
  row.set("CS메모", memo ? `${memo} | ${tag}` : tag);
  await row.save();
  return true;
}

export interface RequestCancellationInput {
  orderId: string;
  ownership: CancelOwnership;
  reason?: string;
}

/**
 * 취소/반품 의도를 배송 단계에 따라 정직하게 분기한다 (§39).
 * 자동 확정은 없다 — 요청 기록 + 운영 이벤트만. 확정은 confirmCancellation.
 */
export async function requestCancellation(
  openDoc: () => Promise<GoogleSpreadsheet>,
  input: RequestCancellationInput,
): Promise<CancelResolution> {
  const doc = await openDoc();
  const record = await findOrderById(doc, input.orderId);
  if (!record) {
    return { ok: false, status: 404, message: "주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다", code: "NOT_FOUND" };
  }
  const owner = resolveOwnership(record, input.ownership);
  if (!owner) {
    // 미존재/소유 불일치 구분 없는 동일 응답 — 열거 방지
    return { ok: false, status: 404, message: "주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다", code: "NOT_FOUND" };
  }

  const status = readOrderStatus(record);
  const reason = (input.reason || "").trim().slice(0, 300);

  if (status === "CANCELLED") {
    return { ok: true, status: 200, process: "CANCELLATION", order_status: status, message: "이미 취소가 완료된 주문입니다." };
  }
  if (status === "REFUNDED" || status === "REFUND_PENDING" || status === "RETURN_REQUESTED") {
    return { ok: true, status: 200, process: "RETURN_REFUND", order_status: status, message: "이미 반품·환불이 진행 중이거나 완료된 주문입니다." };
  }

  if (status === "DRAFT" || status === "PAYMENT_PENDING" || status === "PAID" || status === "PREPARING") {
    // §39 배송준비 — 주문 취소 검토
    await appendCsMemo(doc, input.orderId, `취소요청${reason ? `|사유:${reason}` : ""}`);
    await emitHermesEvent(openDoc, {
      eventType: "ORDER_CANCEL_REQUESTED",
      orderId: input.orderId,
      payload: { channel: owner === "member" ? "member" : "guest", reason: reason || "(미기재)" },
    });
    return {
      ok: true,
      status: 200,
      process: "CANCELLATION",
      order_status: "CANCEL_REQUESTED",
      message: "취소 요청을 접수했어요 — 운영 확인 후 취소가 확정되면 안내드릴게요. 잠시만 기다려 주세요.",
    };
  }

  if (status === "SHIPPED") {
    // §39 배송중 — 취소가 아니라 반품·중단 경계
    await appendCsMemo(doc, input.orderId, `반품요청(배송중)${reason ? `|사유:${reason}` : ""}`);
    await emitHermesEvent(openDoc, {
      eventType: "RETURN_REQUESTED",
      orderId: input.orderId,
      payload: { stage: "in_transit_interception", channel: owner, reason: reason || "(미기재)" },
    });
    return {
      ok: true,
      status: 200,
      process: "RETURN_INTERCEPTION",
      order_status: status,
      message: "상품이 이미 배송 중이에요 — 이 주문은 취소가 아니라 반품·중단 검토로 진행됩니다. 상담원이 확인 후 연결드릴게요.",
    };
  }

  // DELIVERED — 반품·환불 경계로 안내 (시계는 returnPolicy가 산출)
  const { returnWindowOf } = await import("@/lib/returnPolicy");
  const win = returnWindowOf(String(record.raw?.["도착시각"] || ""));
  return {
    ok: true,
    status: 200,
    process: "RETURN_REFUND",
    order_status: status,
    windowLabel: win.windowLabel,
    message: win.expired
      ? "배송이 완료된 주문이에요. 반품 가능 기간이 지나 상태를 다시 확인해 드릴게요 — 상담원 연결을 원하시면 말씀해 주세요."
      : `배송이 완료된 주문이에요 — 취소가 아니라 반품·환불로 진행됩니다. (${win.windowLabel})`,
  };
}

/**
 * 취소 확정 (§53) — 요청된(CANCEL_REQUESTED) 주문만. 오너/운영 검증 후 호출.
 * 결제상태 "취소" 기록 → canonical CANCELLED + 취소 확인 이메일(멱등) + 이벤트.
 */
export async function confirmCancellation(
  openDoc: () => Promise<GoogleSpreadsheet>,
  orderId: string,
  opts: { actor: string } = { actor: "system" },
): Promise<{ ok: boolean; error?: string }> {
  const doc = await openDoc();
  const record = await findOrderById(doc, orderId);
  if (!record) return { ok: false, error: "주문을 찾을 수 없습니다" };
  const status = readOrderStatus(record);
  if (status !== "CANCEL_REQUESTED") {
    return { ok: false, error: `취소 요청 상태가 아닌 주문입니다 (현재: ${status})` };
  }
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return { ok: false, error: "Orders 시트를 찾을 수 없습니다" };
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("주문번호") || "") === orderId);
  if (!row) return { ok: false, error: "주문 행을 찾을 수 없습니다" };
  row.set("결제상태", "취소"); // toCanonicalStatus → CANCELLED (§39 파생 단일 진실)
  row.set("배송상태", "취소");
  await row.save();
  await emitHermesEvent(openDoc, { eventType: "ORDER_CANCELLED", orderId, payload: { actor: opts.actor } });
  await dispatchOrderEmail(doc, record, "cancellation");
  return { ok: true };
}
