"use client";

/**
 * [체크아웃 플로우] 3단계 결제 UX
 * /checkout           — 주문 폼
 * /checkout/payment   — 주문내역 + 계좌안내 + 입금확인 요청
 * /checkout/pending   — 결제 확인 중 (대표자 승인 대기)
 *
 * 주문 데이터는 localStorage("n1_pending_order")에 보관 (세션 간 유지)
 */
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface CartItem { sku: string; name: string; color: string; size: string; qty: number; unit_price: number; }

const SHIPPING_FEE = 3000;
const FREE_SHIPPING_OVER = 50000;
const DEPOSIT = { bank: "케이뱅크", account: "100127890230", holder: "김성빈" };

export function getShippingFee(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
}
export function calcTotal(subtotal: number): number {
  return subtotal + getShippingFee(subtotal);
}

export default function CheckoutFlow({ stage }: { stage: "form" | "payment" | "pending" }) {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", address: "", depositor: "" });
  const [orderId, setOrderId] = useState("");
  const [total, setTotal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // localStorage에서 장바구니/주문 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem("n1_pending_order");
      if (raw) {
        const d = JSON.parse(raw);
        setCart(d.items || []);
        setForm(d.form || form);
        setOrderId(d.order_id || "");
        const sub = (d.items || []).reduce((s: number, i: CartItem) => s + i.unit_price * i.qty, 0);
        setTotal(calcTotal(sub));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePending = (data: any) => {
    localStorage.setItem("n1_pending_order", JSON.stringify(data));
  };

  const subtotal = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const fee = getShippingFee(subtotal);
  const finalTotal = subtotal + fee;

  // ═══ 화면 1: 주문 폼 → /api/orders로 주문 생성 ═══
  const submitForm = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: form.name, phone: form.phone, address: form.address, depositor: form.depositor || form.name },
          items: cart.map((i) => ({ sku: i.sku, color: i.color, colorIndex: -1, size: i.size, qty: i.qty })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        savePending({ items: cart, form, order_id: data.order_id, total: data.total_amount + (data.shipping?.fee ?? fee) });
        router.push("/checkout/payment");
      } else {
        setError(data.error || "주문 처리 실패");
      }
    } catch {
      setError("서버 연결 실패");
    } finally {
      setSubmitting(false);
    }
  };

  // ═══ 화면 2: 입금 완료 확인 요청 → 상태 '입금확인중' ═══
  const confirmDeposit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/cs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: orderId, message: `[입금확인요청] ${orderId} ${form.name} ${finalTotal}원`, customer: { name: form.name } }),
      });
    } catch {}
    // 주문 상태 갱신은 백엔드 파이프라인이 처리 (텔레그램 승인)
    savePending({ items: cart, form, order_id: orderId, total: finalTotal, status: "입금확인중" });
    // 플로팅 위젯에 알림 이벤트
    window.dispatchEvent(new Event("n1_order_update"));
    router.push("/checkout/pending");
  };

  const copyAccount = () => {
    navigator.clipboard?.writeText(`${DEPOSIT.account}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ══════════ 화면 1 ══════════
  if (stage === "form") {
    return (
      <main className="checkout-page">
        <h1 className="checkout-title">주문서 작성</h1>
        <div className="checkout-box">
          {cart.length === 0 ? (
            <p className="checkout-empty">담긴 상품이 없습니다. 상품 페이지에서 상품을 선택해주세요.</p>
          ) : (
            <>
              <div className="checkout-cart">
                {cart.map((i, n) => (
                  <div className="checkout-item" key={n}>
                    <span>{i.name.slice(0, 24)} · {i.color}{i.size && `/${i.size}`} × {i.qty}</span>
                    <b>₩{(i.unit_price * i.qty).toLocaleString()}</b>
                  </div>
                ))}
              </div>
              <div className="checkout-fields">
                <input placeholder="주문자명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input placeholder="연락처 (010-0000-0000)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <input placeholder="배송지 주소" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                <input placeholder="입금자명 (주문자명과 같으면 비워도 됨)" value={form.depositor} onChange={(e) => setForm({ ...form, depositor: e.target.value })} />
              </div>
              <div className="checkout-total">
                <span>상품금액</span><b>₩{subtotal.toLocaleString()}</b>
                <span>배송비</span><b>{fee ? `₩${fee.toLocaleString()}` : "무료"}</b>
                <span className="total-label">총 결제금액</span><b className="total-val">₩{finalTotal.toLocaleString()}</b>
              </div>
              {error && <p className="stock-alert">{error}</p>}
              <button className="checkout-btn" disabled={submitting || !form.name || !form.phone || !form.address}
                onClick={submitForm}>
                {submitting ? "처리 중..." : "주문 폼 작성 완료 →"}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  // ══════════ 화면 2 ══════════
  if (stage === "payment") {
    return (
      <main className="checkout-page">
        <h1 className="checkout-title">주문 내역 확인 & 계좌이체</h1>
        <div className="checkout-box">
          <div className="checkout-cart">
            {cart.map((i, n) => (
              <div className="checkout-item" key={n}>
                <span>{i.name.slice(0, 24)} · {i.color}{i.size && `/${i.size}`} × {i.qty}</span>
                <b>₩{(i.unit_price * i.qty).toLocaleString()}</b>
              </div>
            ))}
          </div>
          <div className="checkout-total">
            <span>상품금액</span><b>₩{subtotal.toLocaleString()}</b>
            <span>배송비</span><b>{fee ? `₩${fee.toLocaleString()}` : "무료배송"}</b>
            <span className="total-label">입금하실 금액</span><b className="total-val">₩{finalTotal.toLocaleString()}</b>
          </div>

          <div className="deposit-emphasis">
            ⚠️ 계좌이체 완료 후 아래 [입금 완료 및 확인 요청] 버튼을 눌러주세요.<br />
            입금 계좌는 좌측 <b>'결제 진행중'</b> 메뉴에서도 언제든 다시 확인하실 수 있습니다.
          </div>

          <div className="deposit-box-lg">
            <div className="deposit-row">
              <span>은행</span><b>{DEPOSIT.bank}</b>
            </div>
            <div className="deposit-row">
              <span>계좌번호</span>
              <b className="account-num">
                {DEPOSIT.account}
                <button className="copy-btn" onClick={copyAccount}>{copied ? "✓ 복사됨" : "복사"}</button>
              </b>
            </div>
            <div className="deposit-row"><span>예금주</span><b>{DEPOSIT.holder}</b></div>
            <div className="deposit-row"><span>입금자명</span><b>{form.depositor || form.name || "-"}</b></div>
            <div className="deposit-row highlight"><span>입금 금액</span><b>₩{finalTotal.toLocaleString()}</b></div>
          </div>

          <button className="checkout-btn big" disabled={submitting} onClick={confirmDeposit}>
            {submitting ? "처리 중..." : "[ 입금 완료 및 확인 요청 ]"}
          </button>
        </div>
      </main>
    );
  }

  // ══════════ 화면 3 ══════════
  return (
    <main className="checkout-page">
      <div className="checkout-box pending-box">
        <div className="pending-icon">⏳</div>
        <h1 className="checkout-title">결제 확인 중입니다</h1>
        <p className="pending-text">
          1분 내로 입금 확인 후 정상 처리될 예정이오니 잠시만 기다려주세요.<br />
          확인이 완료되면 이 화면이 자동으로 <b>'결제 완료 및 출고 준비 중'</b>으로 전환됩니다.
        </p>
        <div className="deposit-box-lg">
          <div className="deposit-row"><span>주문번호</span><b>{orderId}</b></div>
          <div className="deposit-row"><span>입금 금액</span><b>₩{finalTotal.toLocaleString()}</b></div>
          <div className="deposit-row"><span>입금 계좌</span><b>{DEPOSIT.bank} {DEPOSIT.account}</b></div>
        </div>
        <p className="buy-note">이 페이지를 닫아도 좌측 '결제 진행중' 위젯에서 상태를 확인할 수 있습니다.</p>
      </div>
    </main>
  );
}
