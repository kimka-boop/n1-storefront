"use client";
/**
 * N°1 Admin — 주문/환불 관리 페이지
 * 기능: 주문 목록/상세, 상태 변경, 취소/환불 요청 확인, 환불 처리, 이력, 검색
 * (CORE OPERATING SPEC v1.0 PART 3~5 — 주문 row 삭제 없음, PG 환불 미연결)
 */
import { useEffect, useMemo, useState } from "react";

type Order = {
  _row: number; order_id: string; order_date: string; payment_method: string;
  payment_status: string; order_state: string; customer_name: string; phone: string;
  address: string; items: string; total: string; ship_type: string;
  cancel_state: string; return_state: string; refund_state: string;
  tracking: string; memo: string;
};
type Refund = {
  _row: number; refund_id: string; order_id: string; product_id: string;
  quantity: string; refund_reason: string; refund_type: string; requested_at: string;
  approved_at: string; return_received: string; amount: string; completed_at: string;
  processed_by: string; memo: string; status: string;
};

const ORDER_STATES = ["PENDING","PAID","PREPARING","SHIPPED","DELIVERED","COMPLETED"];
const CANCEL_STATES = ["CANCEL_REQUESTED","CANCELLED"];
const REFUND_FLOW = ["REFUND_REQUESTED","REFUND_APPROVED","RETURN_SHIPPING","RETURN_RECEIVED","REFUNDED"];

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [msg, setMsg] = useState("");
  const [refundForm, setRefundForm] = useState({ product_id: "", quantity: 1, refund_reason: "", refund_type: "RETURN", refund_amount: "", memo: "" });

  const load = async (query = "") => {
    const r = await fetch(`/api/admin/orders${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    const d = await r.json();
    if (d.ok) { setOrders(d.orders); setRefunds(d.refunds); }
    else setMsg(`오류: ${d.error}`);
  };
  useEffect(() => { load(); }, []);

  const act = async (payload: any) => {
    const r = await fetch("/api/admin/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const d = await r.json();
    setMsg(d.ok ? `✅ 처리 완료: ${JSON.stringify(d)}` : `❌ ${d.error}`);
    load();
  };

  const openDetail = (o: Order) => { setDetail(o); setMsg(""); };
  const refundsOf = (oid: string) => refunds.filter((r) => r.order_id === oid);

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 20, letterSpacing: 2 }}>N°1 ADMIN — ORDERS / REFUNDS</h1>
      <p style={{ color: "#888", fontSize: 12 }}>주문 데이터는 삭제되지 않습니다. 상태만 변경됩니다. (SPEC v1.0)</p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input placeholder="주문번호/고객명/전화 검색" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 4 }}
          onKeyDown={(e) => e.key === "Enter" && load(q)} />
        <button onClick={() => load(q)} style={{ padding: "8px 16px" }}>검색</button>
      </div>

      {msg && <p style={{ background: "#f5f5f5", padding: 8, fontSize: 13 }}>{msg}</p>}

      {/* 주문 목록 */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #222" }}>
            {["주문번호","일시","고객","주문상태","결제상태","총액","취소","환불","작업"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 6 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr><td colSpan={9} style={{ padding: 16, color: "#999" }}>주문 데이터가 없습니다.</td></tr>
          )}
          {orders.map((o) => (
            <tr key={o.order_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 6 }}><button onClick={() => openDetail(o)} style={{ textDecoration: "underline" }}>{o.order_id}</button></td>
              <td style={{ padding: 6 }}>{o.order_date.slice(0, 16).replace("T", " ")}</td>
              <td style={{ padding: 6 }}>{o.customer_name}</td>
              <td style={{ padding: 6 }}><b>{o.order_state}</b></td>
              <td style={{ padding: 6 }}>{o.payment_status}</td>
              <td style={{ padding: 6 }}>{Number(o.total).toLocaleString()}원</td>
              <td style={{ padding: 6, color: o.cancel_state ? "#c00" : "#999" }}>{o.cancel_state || "-"}</td>
              <td style={{ padding: 6, color: o.refund_state ? "#c60" : "#999" }}>{o.refund_state || "-"}</td>
              <td style={{ padding: 6 }}>
                <button onClick={() => openDetail(o)} style={{ fontSize: 12 }}>상세</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 주문 상세 */}
      {detail && (
        <section style={{ marginTop: 24, border: "1px solid #ddd", padding: 16, borderRadius: 6 }}>
          <h2 style={{ fontSize: 16 }}>{detail.order_id} — {detail.customer_name}</h2>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>주문일시: {detail.order_date}</div>
            <div>연락처: {detail.phone} / 배송지: {detail.address}</div>
            <div>주문항목: <code style={{ fontSize: 11 }}>{detail.items}</code></div>
            <div>총결제금액: <b>{Number(detail.total).toLocaleString()}원</b> / 배송유형: {detail.ship_type}</div>
            <div>취소상태: {detail.cancel_state || "-"} / 반품: {detail.return_state || "-"} / 환불: {detail.refund_state || "-"}</div>
            <div>송장: {detail.tracking || "-"} / 메모: {detail.memo || "-"}</div>
          </div>

          {/* 주문 상태 변경 */}
          <h3 style={{ fontSize: 14, marginTop: 16 }}>주문 상태 변경</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ORDER_STATES.map((s) => (
              <button key={s} onClick={() => act({ action: "set_state", oid: detail.order_id, order_state: s })}
                style={{ padding: "6px 10px", fontSize: 12, background: s === detail.order_state ? "#222" : "#fff", color: s === detail.order_state ? "#fff" : "#222", border: "1px solid #222" }}>
                {s}
              </button>
            ))}
          </div>

          {/* 취소 */}
          <h3 style={{ fontSize: 14, marginTop: 16 }}>취소</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {CANCEL_STATES.map((s) => (
              <button key={s} onClick={() => act({ action: "set_cancel", oid: detail.order_id, cancel_state: s })}
                style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #c00", color: "#c00", background: "#fff" }}>
                {s}
              </button>
            ))}
          </div>

          {/* 환불 요청 생성 */}
          <h3 style={{ fontSize: 14, marginTop: 16 }}>환불 요청 생성</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 13 }}>
            <input placeholder="product_id" value={refundForm.product_id}
              onChange={(e) => setRefundForm({ ...refundForm, product_id: e.target.value })}
              style={{ padding: 6, border: "1px solid #ccc" }} />
            <input type="number" min={1} placeholder="수량" value={refundForm.quantity}
              onChange={(e) => setRefundForm({ ...refundForm, quantity: Number(e.target.value) })}
              style={{ padding: 6, border: "1px solid #ccc" }} />
            <input placeholder="환불 금액" value={refundForm.refund_amount}
              onChange={(e) => setRefundForm({ ...refundForm, refund_amount: e.target.value })}
              style={{ padding: 6, border: "1px solid #ccc" }} />
            <select value={refundForm.refund_type} onChange={(e) => setRefundForm({ ...refundForm, refund_type: e.target.value })}
              style={{ padding: 6, border: "1px solid #ccc" }}>
              <option value="RETURN">RETURN</option><option value="CANCEL">CANCEL</option><option value="EXCHANGE">EXCHANGE</option>
            </select>
            <input placeholder="환불 사유" value={refundForm.refund_reason}
              onChange={(e) => setRefundForm({ ...refundForm, refund_reason: e.target.value })}
              style={{ padding: 6, border: "1px solid #ccc", gridColumn: "span 2" }} />
            <input placeholder="메모" value={refundForm.memo}
              onChange={(e) => setRefundForm({ ...refundForm, memo: e.target.value })}
              style={{ padding: 6, border: "1px solid #ccc", gridColumn: "span 3" }} />
          </div>
          <button
            onClick={() => act({ action: "create_refund", oid: detail.order_id, ...refundForm, processed_by: "admin-web" })}
            style={{ marginTop: 8, padding: "8px 16px", background: "#222", color: "#fff" }}>
            환불 요청 기록 (주문 유지)
          </button>

          {/* 환불 이력 */}
          <h3 style={{ fontSize: 14, marginTop: 20 }}>환불 처리 이력</h3>
          {refundsOf(detail.order_id).length === 0 && <p style={{ fontSize: 12, color: "#999" }}>환불 이력 없음</p>}
          {refundsOf(detail.order_id).map((rf) => (
            <div key={rf.refund_id} style={{ borderTop: "1px solid #eee", padding: "8px 0", fontSize: 13 }}>
              <b>{rf.refund_id}</b> | {rf.product_id} x{rf.quantity} | {rf.refund_type} | {Number(rf.amount).toLocaleString()}원
              <div style={{ color: "#666", fontSize: 12 }}>
                사유: {rf.refund_reason} / 신청: {rf.requested_at?.slice(0, 16)} / 승인: {rf.approved_at?.slice(0, 16) || "-"} / 완료: {rf.completed_at?.slice(0, 16) || "-"} / 담당: {rf.processed_by}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                {REFUND_FLOW.map((s) => (
                  <button key={s} onClick={() => act({ action: "update_refund", refund_id: rf.refund_id, status: s, processed_by: "admin-web" })}
                    style={{ fontSize: 11, padding: "4px 8px", background: s === rf.status ? "#222" : "#fff", color: s === rf.status ? "#fff" : "#222", border: "1px solid #222" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <button onClick={() => setDetail(null)} style={{ marginTop: 16 }}>닫기</button>
        </section>
      )}
    </main>
  );
}
