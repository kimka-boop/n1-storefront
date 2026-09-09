"use client";

/**
 * [결제 진행 현황 팝업] — Storefront Repair(2026-09-10, §12) 갱신
 * 우측 하단 플로팅 바(float-bar)는 제거되고 장바구니는 상단 분할 글래스(UtilityDock)로 이동.
 * 본 컴포넌트는 '결제 진행 현황' 팝업만 소유한다 — 진입 경로:
 *   · CartDrawer '결제 진행 현황' 링크 (n1:open-order-tracker 이벤트)
 *   · n1:open-order-tracker 이벤트 (기존 계약 유지)
 * 주문 상태는 localStorage n1_pending_order — 팝업 이동과 무관하게 유지된다.
 */
import { useState, useEffect } from "react";

const DEPOSIT = { bank: "케이뱅크", account: "100127890230", holder: "김성빈" };

export default function FloatingOrderTracker() {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("n1_pending_order");
        // [SESSION L · TASK 29] 저장본 검증(CheckoutFlow.loadPending과 동일 기준) —
        // 손상·부재 레코드로 ₩0 유령 팝업을 띄우지 않고, 제거된 주문은 팝업도 내린다
        if (!raw) { setOrder(null); return; }
        const d = JSON.parse(raw);
        setOrder(d && d.order_id && Array.isArray(d.items) ? d : null);
      } catch {
        setOrder(null);
      }
    };
    load();
    window.addEventListener("n1_order_update", load);
    const t = setInterval(load, 15000); // 상태 갱신
    return () => { window.removeEventListener("n1_order_update", load); clearInterval(t); };
  }, []);

  // 결제 진행 현황 직접 열기 요청 (CartDrawer 등에서 사용)
  useEffect(() => {
    const openTracker = () => setOpen(true);
    window.addEventListener("n1:open-order-tracker", openTracker);
    return () => window.removeEventListener("n1:open-order-tracker", openTracker);
  }, []);

  const status = order?.status || (order?.order_id ? "입금 대기" : null);
  const subtotal = (order?.items || []).reduce((s: number, i: any) => s + i.unit_price * i.qty, 0);
  const fee = subtotal >= 50000 ? 0 : 3000;
  const total = order?.total || subtotal + fee;

  // [SESSION L] 복사 결과를 정직하게 표시한다 — 성공/실패 무피드백 금지
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DEPOSIT.account);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
    setTimeout(() => { setCopied(false); setCopyFailed(false); }, 2000);
  };

  if (!open || !order) return null;

  return (
    <div className="float-popup">
      <div className="float-popup-head">
        <b>결제 진행 현황</b>
        <button onClick={() => setOpen(false)} aria-label="결제 진행 현황 닫기">✕</button>
      </div>
      <div className="float-popup-body">
        <div className="deposit-row"><span>주문번호</span><b>{order.order_id}</b></div>
        <div className="deposit-row"><span>상태</span><b className={status?.includes("완료") ? "green" : ""}>{status}</b></div>
        <div className="deposit-row"><span>입금 계좌</span>
          <b>{DEPOSIT.bank} {DEPOSIT.account} <button className="copy-btn" onClick={copy}>{copied ? "✓ 복사됨" : copyFailed ? "복사 실패" : "복사"}</button></b>
        </div>
        <div className="deposit-row"><span>예금주</span><b>{DEPOSIT.holder}</b></div>
        <div className="deposit-row highlight"><span>입금 금액</span><b>₩{Number(total).toLocaleString()}</b></div>
        {order.items?.map((i: any, n: number) => (
          <p className="float-item" key={n}>· {i.name.slice(0, 22)} ({i.color}{i.size && `/${i.size}`}) ×{i.qty}</p>
        ))}
      </div>
    </div>
  );
}
