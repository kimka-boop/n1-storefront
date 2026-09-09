"use client";

/**
 * [우측 플로팅 바] 장바구니 아이콘 + 결제 진행 현황
 * - 클릭: 카트에 상품이 있든 없든 '실제 카트 경험'을 연다 (미션 §3 버그 수정)
 *   · 카트 있음 → CartDrawer
 *   · 카트 비었음 + 진행 중 주문 → 결제 진행 현황 팝업 (기존 기능 유지)
 *   · 둘 다 없음 → CartDrawer(빈 상태)
 * - 진행 중 주문 상태 칩 클릭 → 결제 진행 현황 팝업 직접 열기
 * - 재고 미확정 안내 등에서 열던 결제 팝업 경로는 "n1:open-order-tracker" 이벤트로 유지
 */
import { useState, useEffect } from "react";
import { CartIcon, CardIcon } from "./Icons";
import { useCart } from "./CartProvider";

const DEPOSIT = { bank: "케이뱅크", account: "100127890230", holder: "김성빈" };

export default function FloatingOrderTracker() {
  const { count, setOpen: setCartOpen } = useCart();
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

  const onBarClick = () => {
    if (count === 0 && status) {
      setOpen(true); // 카트가 비었고 진행 중 주문이 있으면 결제 현황이 실질적 '진행 중' 경험
      return;
    }
    setCartOpen(true); // 카트 드로어 (빈 상태 포함)
  };

  return (
    <>
      <div className="float-bar" onClick={onBarClick} role="button" aria-label={`장바구니${count ? ` — ${count}개 상품` : ""} 열기`}>
        <span className="float-icon">
          <CartIcon size={14} />
        </span>
        {count > 0 && <span className="float-count">{count}</span>}
        {status && (
          <button
            className={`float-status ${status.includes("완료") ? "done" : ""}`}
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            aria-label="결제 진행 현황 열기"
          >
            <CardIcon size={12} /> {status}
          </button>
        )}
      </div>

      {open && order && (
        <div className="float-popup">
          <div className="float-popup-head">
            <b>결제 진행 현황</b>
            <button onClick={() => setOpen(false)}>✕</button>
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
      )}
    </>
  );
}
