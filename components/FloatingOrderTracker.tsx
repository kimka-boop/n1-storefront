"use client";

/**
 * [좌측 플로팅 바] 결제 진행 현황 위젯
 * - 사이트 왼쪽에 밀착, 스크롤 따라다님
 * - 클릭 시 현재 주문/입금 계좌 팝업
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
        if (raw) setOrder(JSON.parse(raw));
      } catch {}
    };
    load();
    window.addEventListener("n1_order_update", load);
    const t = setInterval(load, 15000); // 상태 갱신
    return () => { window.removeEventListener("n1_order_update", load); clearInterval(t); };
  }, []);

  const status = order?.status || (order?.order_id ? "입금 대기" : null);
  const subtotal = (order?.items || []).reduce((s: number, i: any) => s + i.unit_price * i.qty, 0);
  const fee = subtotal >= 50000 ? 0 : 3000;
  const total = order?.total || subtotal + fee;

  const copy = () => navigator.clipboard?.writeText(DEPOSIT.account);

  return (
    <>
      <div className="float-bar" onClick={() => order && setOpen(true)}>
        <span className="float-icon">🛒</span>
        {status && (
          <span className={`float-status ${status.includes("완료") ? "done" : ""}`}>💳 {status}</span>
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
              <b>{DEPOSIT.bank} {DEPOSIT.account} <button className="copy-btn" onClick={copy}>복사</button></b>
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
