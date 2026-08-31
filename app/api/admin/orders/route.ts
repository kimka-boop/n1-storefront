/**
 * N°1 — Admin Orders/Refunds API
 * GET  /api/admin/orders          → 주문 목록 (검색: ?q=)
 * GET  /api/admin/orders?oid=...  → 주문 상세 + 관련 환불 이력
 * POST /api/admin/orders          → 상태 변경 / 환불 처리
 *   body: { action: "set_state", oid, order_state? }
 *   body: { action: "set_cancel", oid, cancel_state }
 *   body: { action: "create_refund", oid, product_id, quantity, refund_reason,
 *           refund_type, refund_amount, processed_by, memo }
 *   body: { action: "update_refund", refund_id, status, ... }
 *
 * 주문 row는 절대 삭제하지 않는다 (SPEC v1.0 PART 4).
 * 실제 PG 환불 API 호출 없음 — RefundProvider abstraction 지점만 마련.
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function loadSheetId(): string {
  if (process.env.N1_SHEET_ID) return process.env.N1_SHEET_ID;
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), "..", ".env"), "utf-8").split("\n")) {
      if (line.startsWith("N1_SHEET_ID=")) return line.split("=")[1].trim();
    }
  } catch {}
  return "";
}

async function getDoc() {
  let email: string, key: string;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else {
    const cred = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "credentials.json"), "utf-8"));
    email = cred.client_email;
    key = cred.private_key;
  }
  const auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const doc = new GoogleSpreadsheet(loadSheetId(), auth);
  await doc.loadInfo();
  return doc;
}

function cell(r: any, k: string): string {
  return String(r.get(k) || "").trim();
}

export async function GET(req: Request) {
  try {
    const doc = await getDoc();
    const url = new URL(req.url);
    const oid = url.searchParams.get("oid");
    const q = (url.searchParams.get("q") || "").toLowerCase();

    const ordersSheet = doc.sheetsByTitle["Orders"];
    const oRows = await ordersSheet.getRows();

    let orders = oRows.map((r: any, i: number) => ({
      _row: i + 2,
      order_id: cell(r, "주문번호"),
      order_date: cell(r, "주문일시"),
      payment_method: cell(r, "결제수단"),
      payment_status: cell(r, "결제상태"),
      order_state: cell(r, "주문상태") || "PENDING",
      customer_name: cell(r, "고객명"),
      phone: cell(r, "연락처"),
      address: cell(r, "배송지"),
      items: cell(r, "주문항목"),
      total: cell(r, "총결제금액"),
      ship_type: cell(r, "배송유형"),
      cancel_state: cell(r, "취소상태"),
      return_state: cell(r, "반품상태"),
      refund_state: cell(r, "환불상태"),
      tracking: cell(r, "송장번호"),
      memo: cell(r, "CS메모"),
    }));

    if (oid) orders = orders.filter((o) => o.order_id === oid);
    if (q) {
      orders = orders.filter((o) =>
        [o.order_id, o.customer_name, o.phone, o.items].join(" ").toLowerCase().includes(q)
      );
    }

    // 환불 이력
    let refunds: any[] = [];
    try {
      const refundsSheet = doc.sheetsByTitle["Refunds"];
      const rRows = await refundsSheet.getRows();
      refunds = rRows.map((r: any, i: number) => ({
        _row: i + 2,
        refund_id: cell(r, "refund_id"),
        order_id: cell(r, "order_id"),
        product_id: cell(r, "product_id"),
        quantity: cell(r, "quantity"),
        refund_reason: cell(r, "refund_reason"),
        refund_type: cell(r, "refund_type"),
        requested_at: cell(r, "refund_requested_at"),
        approved_at: cell(r, "refund_approved_at"),
        return_received: cell(r, "return_received"),
        amount: cell(r, "refund_amount"),
        completed_at: cell(r, "refund_completed_at"),
        processed_by: cell(r, "processed_by"),
        memo: cell(r, "memo"),
        status: cell(r, "status"),
      }));
      if (oid) refunds = refunds.filter((x) => x.order_id === oid);
    } catch {}

    return NextResponse.json({ ok: true, orders, refunds, total: orders.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const doc = await getDoc();
    const action = body.action;
    const now = new Date().toISOString();

    // ── 주문 상태 변경 ──
    if (action === "set_state") {
      const { oid, order_state } = body;
      const sheet = doc.sheetsByTitle["Orders"];
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => cell(r, "주문번호") === oid);
      if (!row) return NextResponse.json({ ok: false, error: "주문 없음" }, { status: 404 });
      row.set("주문상태", order_state);
      if (order_state === "PAID") row.set("결제상태", "입금완료");
      await row.save();
      return NextResponse.json({ ok: true, order_id: oid, order_state });
    }

    // ── 취소 상태 ──
    if (action === "set_cancel") {
      const { oid, cancel_state } = body;
      const sheet = doc.sheetsByTitle["Orders"];
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => cell(r, "주문번호") === oid);
      if (!row) return NextResponse.json({ ok: false, error: "주문 없음" }, { status: 404 });
      row.set("취소상태", cancel_state);
      await row.save();
      return NextResponse.json({ ok: true, order_id: oid, cancel_state });
    }

    // ── 환불 요청 생성 (주문 삭제 없음 — Refunds 시트에 기록) ──
    if (action === "create_refund") {
      const { oid, product_id, quantity, refund_reason, refund_type, refund_amount, processed_by, memo } = body;
      const ordersSheet = doc.sheetsByTitle["Orders"];
      const oRows = await ordersSheet.getRows();
      const orow = oRows.find((r: any) => cell(r, "주문번호") === oid);
      if (!orow) return NextResponse.json({ ok: false, error: "주문 없음" }, { status: 404 });

      const refundId = `RFD-${now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const refundsSheet = doc.sheetsByTitle["Refunds"];
      await refundsSheet.addRow({
        refund_id: refundId,
        order_id: oid,
        product_id: product_id || "",
        quantity: String(quantity ?? 1),
        refund_reason: refund_reason || "",
        refund_type: refund_type || "RETURN", // RETURN | CANCEL | EXCHANGE
        refund_requested_at: now,
        refund_approved_at: "",
        return_received: "",
        refund_amount: String(refund_amount ?? ""),
        refund_completed_at: "",
        processed_by: processed_by || "admin",
        memo: memo || "",
        status: "REFUND_REQUESTED",
      });
      // 주문 row에 환불 상태 표기 (주문 자체는 유지)
      orow.set("환불상태", "REFUND_REQUESTED");
      await orow.save();
      return NextResponse.json({ ok: true, refund_id: refundId, status: "REFUND_REQUESTED" });
    }

    // ── 환불 상태 갱신 ──
    if (action === "update_refund") {
      const { refund_id, status, processed_by, memo, refund_amount } = body;
      const refundsSheet = doc.sheetsByTitle["Refunds"];
      const rRows = await refundsSheet.getRows();
      const row = rRows.find((r: any) => cell(r, "refund_id") === refund_id);
      if (!row) return NextResponse.json({ ok: false, error: "환불 기록 없음" }, { status: 404 });

      row.set("status", status);
      if (status === "REFUND_APPROVED") row.set("refund_approved_at", now);
      if (status === "RETURN_RECEIVED") row.set("return_received", "YES");
      if (status === "REFUNDED") row.set("refund_completed_at", now);
      if (refund_amount) row.set("refund_amount", String(refund_amount));
      if (processed_by) row.set("processed_by", processed_by);
      if (memo) row.set("memo", memo);
      await row.save();

      // 주문 row 환불상태 동기화
      const oid = cell(row, "order_id");
      const ordersSheet = doc.sheetsByTitle["Orders"];
      const oRows = await ordersSheet.getRows();
      const orow = oRows.find((r: any) => cell(r, "주문번호") === oid);
      if (orow) {
        orow.set("환불상태", status);
        await orow.save();
      }

      // ⚠️ 실제 PG 환불 API는 여기에 RefundProvider abstraction으로 연결 예정 (PG 미확정 → 호출 없음)
      return NextResponse.json({ ok: true, refund_id, status, note: "PG refund API not invoked (PG 미연결)" });
    }

    return NextResponse.json({ ok: false, error: `알 수 없는 action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
