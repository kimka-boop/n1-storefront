/**
 * N°1 TRANSACTIONAL EMAILS — 주문 라이프사이클 이벤트 이메일 (미션 §54·§62·§24)
 *
 * - 이벤트 트리거: 주문 접수 / 배송 시작 / 취소 완료 / 환불 완료 (인증 메일은 기존 경로)
 * - 멱등: 시트 마커 컬럼(발송시각·상태)으로 1회만 발송 — 재시도·재폴링이 재발송하지 않는다.
 * - 전송 경계: 실제 제공자 미연결 → bridge 큐(delivery:"bridge") 또는 정직 실패.
 *   이메일 실패는 배송/주문 진실을 바꾸지 않는다 (미션 §24).
 * - 수신자: 회원=주문 스냅샷 이메일, 게스트=체크아웃 이메일 (고객이메일 컬럼 공용).
 */
import { queueBridgeTransactional, type EmailSendResult } from "@/lib/emailProvider";
import { getOrdersSheet, type OrderRecord } from "@/lib/sheets";
import { PDP_SHIPPING_COPY } from "@/lib/businessRules";
import type { GoogleSpreadsheet } from "google-spreadsheet";

export type OrderEmailKind = "order_confirmation" | "shipment_started" | "cancellation" | "refund_completed";

const MARKER_COLUMNS: Record<OrderEmailKind, [string, string]> = {
  order_confirmation: ["주문확인이메일발송시각", "주문확인이메일상태"],
  shipment_started: ["배송이메일발송시각", "배송이메일상태"],
  cancellation: ["취소이메일발송시각", "취소이메일상태"],
  refund_completed: ["환불이메일발송시각", "환불이메일상태"],
};

interface OrderEmailData {
  orderId: string;
  to: string;
  itemsDesc: string;
  subtotal: number;
  shippingFee: number;
  total: number;
  paymentMethod: string;
  recipient: string;
  carrier?: string;
  trackingNo?: string;
  shippedAt?: string;
  refundAmount?: number;
}

function fmtWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export function renderOrderEmail(kind: OrderEmailKind, d: OrderEmailData): { subject: string; text: string } {
  const head = `안녕하세요, ${d.recipient || "고객"}님.\n주문번호 ${d.orderId}의 소식을 전해드립니다.`;
  const lines = d.itemsDesc;
  const money = `상품금액 ${fmtWon(d.subtotal)} / 배송비 ${d.shippingFee ? fmtWon(d.shippingFee) : "무료"} / 합계 ${fmtWon(d.total)}`;
  switch (kind) {
    case "order_confirmation":
      return {
        subject: `[N°1] 주문이 접수되었습니다 (${d.orderId})`,
        text: [
          head,
          "",
          "· 주문 상품",
          lines,
          "",
          `· 결제 정보: ${money} (${d.paymentMethod})`,
          `· 배송지: ${d.recipient}`,
          "",
          PDP_SHIPPING_COPY[0],
          "",
          "입금 확인 후 출고가 진행됩니다. 문의는 스토어 우측 하단 '문의하기'로 연결해 주세요.",
          "",
          "— N°1",
        ].join("\n"),
      };
    case "shipment_started":
      return {
        subject: `[N°1] 주문하신 상품의 배송이 시작되었습니다`,
        text: [
          head,
          "",
          "· 배송 상품",
          lines,
          "",
          `· 택배사: ${d.carrier || "-"}`,
          `· 운송장 번호: ${d.trackingNo || "-"}`,
          `· 배송 시작일: ${(d.shippedAt || "").slice(0, 10) || "-"}`,
          "",
          "— N°1",
        ].join("\n"),
      };
    case "cancellation":
      return {
        subject: `[N°1] 주문이 취소되었습니다 (${d.orderId})`,
        text: [head, "", "· 취소 상품", lines, "", `· 취소 금액: ${fmtWon(d.total)}`, "", "— N°1"].join("\n"),
      };
    case "refund_completed":
      return {
        subject: `[N°1] 환불이 완료되었습니다 (${d.orderId})`,
        text: [
          head,
          "",
          "· 환불 상품",
          lines,
          "",
          `· 환불 금액: ${fmtWon(d.refundAmount ?? d.total)}`,
          "",
          "— N°1",
        ].join("\n"),
      };
  }
}

function itemsDescription(order: OrderRecord): string {
  try {
    const items = JSON.parse(order.itemsJson || "[]") as Array<{ name?: string; sku?: string; color?: string; size?: string; qty?: number }>;
    return items
      .map((i) => `- ${i.name || i.sku}${i.color ? ` (${i.color}${i.size ? ` / ${i.size}` : ""})` : ""} x${i.qty ?? 1}`)
      .join("\n");
  } catch {
    return `- ${order.orderId}`;
  }
}

export interface OrderEmailDispatchResult {
  sent: boolean;
  /** "bridge"=큐 적재 / "sent"=실전송(provider 연결 시) / "skipped"=이미 발송(멱등) / "no_email" / "failed" */
  status: string;
  ref?: string;
  error?: string;
}

/**
 * 멱등 발송 — 마커 컬럼에 기록이 있으면 재발송하지 않는다 (§54: retry 중복 금지).
 * 주문 행을 직접 갱신한다 (이메일 실패가 주문 상태를 바꾸지 않는다 — 상태 변경과 분리).
 */
const emailDispatchInFlight = new Set<string>();

export async function dispatchOrderEmail(
  doc: GoogleSpreadsheet,
  order: OrderRecord,
  kind: OrderEmailKind,
  extra: Partial<Pick<OrderEmailData, "carrier" | "trackingNo" | "shippedAt" | "refundAmount">> = {},
): Promise<OrderEmailDispatchResult> {
  // 동시 발송 경합 차단 — 마커 검사와 기록 사이의 창에서 이중 발송된다 (실측 결함)
  const lockKey = order.orderId + ":" + kind;
  if (emailDispatchInFlight.has(lockKey)) return { sent: false, status: "skipped" };
  emailDispatchInFlight.add(lockKey);
  try {
    return await dispatchOrderEmailInner(doc, order, kind, extra);
  } finally {
    emailDispatchInFlight.delete(lockKey);
  }
}

async function dispatchOrderEmailInner(
  doc: GoogleSpreadsheet,
  order: OrderRecord,
  kind: OrderEmailKind,
  extra: Partial<Pick<OrderEmailData, "carrier" | "trackingNo" | "shippedAt" | "refundAmount">> = {},
): Promise<OrderEmailDispatchResult> {
  const to = String(order.raw?.["고객이메일"] || "").trim();
  if (!to) return { sent: false, status: "no_email", error: "주문에 수신 이메일이 없습니다" };

  const sheet = await getOrdersSheet(doc);
  if (!sheet) return { sent: false, status: "failed", error: "Orders 시트를 찾을 수 없습니다" };

  // 멱등 확인 — 행 단위 마커
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("주문번호") || "") === order.orderId);
  if (!row) return { sent: false, status: "failed", error: "주문 행을 찾을 수 없습니다" };
  const [tsCol, statusCol] = MARKER_COLUMNS[kind];
  if (String(row.get(tsCol) || "").trim()) {
    return { sent: false, status: "skipped" };
  }

  const itemsDesc = itemsDescription(order);
  const subtotal = Number(String(order.raw?.["상품금액"] || "0").replace(/[^\d]/g, "")) || 0;
  const shippingFee = Number(String(order.raw?.["배송비"] || "0").replace(/[^\d]/g, "")) || 0;
  const total = order.total || subtotal + shippingFee;
  const data: OrderEmailData = {
    orderId: order.orderId,
    to,
    itemsDesc,
    subtotal,
    shippingFee,
    total,
    paymentMethod: order.paymentMethod === "bank_transfer" ? "무통장입금" : order.paymentMethod,
    recipient: order.customerName,
    carrier: extra.carrier,
    trackingNo: extra.trackingNo,
    shippedAt: extra.shippedAt,
    refundAmount: extra.refundAmount,
  };
  const { subject, text } = renderOrderEmail(kind, data);

  const resolved = resolveSend();
  let result: EmailSendResult;
  if (resolved.mode === "bridge") {
    result = queueBridgeTransactional({ to, subject, text, kind, refId: order.orderId });
  } else {
    result = { ok: false, provider: "no_email_provider", code: "EMAIL_PROVIDER_NOT_CONFIGURED", message: "이메일 발송 준비 중입니다." };
  }

  const now = new Date().toISOString();
  row.set(tsCol, now);
  row.set(
    statusCol,
    result.ok ? (result.delivery === "bridge" ? "BRIDGE_QUEUED" : "SENT") : `FAILED:${result.code || "ERROR"}`,
  );
  try {
    await row.save();
  } catch (e) {
    return { sent: false, status: "failed", error: `마커 기록 실패: ${(e as Error).message}` };
  }
  return result.ok
    ? { sent: true, status: result.delivery === "bridge" ? "bridge" : "sent", ref: result.ref }
    : { sent: false, status: "failed", error: result.message };
}

function resolveSend(): { mode: "bridge" | "none" } {
  const configured = (process.env.N1_EMAIL_PROVIDER || "").trim().toLowerCase();
  return configured === "bridge" ? { mode: "bridge" } : { mode: "none" };
}
