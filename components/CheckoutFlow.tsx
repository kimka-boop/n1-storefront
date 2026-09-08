"use client";

/**
 * [체크아웃 플로우] PG-ready 결제 UX (미션 §9–§13)
 *
 * /checkout           — ①상품 확인 ②주문자/배송 정보 ③결제 정보 ④최종 주문 검토
 * /checkout/payment   — 무통장입금 안내 + [입금 완료 및 확인 요청]
 * /checkout/pending   — 입금 확인 중 (운영자 승인 대기)
 *
 * - 소스: cart(전체 카트) 또는 buynow(PDP 바로 구매 — 현재 선택만, 카트 미포함)
 * - 주문 생성 = POST /api/orders (서버가 금액·재고 재검증) → 생성 시점에 카트 비움
 * - PG는 미연결: fake payment success 없음, 카드 결제는 "결제 시스템 연결 준비 중" 표시
 * - 회원이면 이메일 prefill(수정 가능), 배송 정보는 account profile과 분리된 주문 snapshot
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useCart } from "@/components/CartProvider";
import { colorDisplayLabel } from "@/lib/cart";
import { getShippingFee, takeBuyNow, clearBuyNow } from "@/lib/checkout";
import { getPaymentMethods } from "@/lib/payments";

interface CheckoutLine {
  sku: string;
  name: string;
  color: string;
  size: string;
  qty: number;
  unit_price: number;
  image?: string;
}

const DEPOSIT = { bank: "케이뱅크", account: "100127890230", holder: "김성빈" };
const PENDING_ORDER_KEY = "n1_pending_order";

type Source = "cart" | "buynow";

interface PendingOrder {
  items: CheckoutLine[];
  form: { name: string; phone: string; address: string; depositor: string; email?: string };
  order_id: string;
  total: number;
  source: Source;
  status?: string;
  splitNotice?: string;
}

function won(n: number): string {
  return `₩${n.toLocaleString("ko-KR")}`;
}

function loadPending(): PendingOrder | null {
  try {
    const raw = localStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.order_id || !Array.isArray(d.items)) return null;
    return d as PendingOrder;
  } catch {
    return null;
  }
}

export default function CheckoutFlow({ stage }: { stage: "form" | "payment" | "pending" }) {
  const router = useRouter();
  const { token: authToken, email: authEmail } = useAuth();
  const { items: cartItems, clear: clearCart, ready: cartReady } = useCart();

  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [source, setSource] = useState<Source>("cart");
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<{ name: string; phone: string; address: string; depositor: string; email?: string }>({ name: "", phone: "", address: "", depositor: "", email: "" });
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [reviewed, setReviewed] = useState(false); // ④ 최종 주문 검토 확인
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // ── 소스 결정: buynow stash 우선(직전 PDP 진입), 없으면 카트 — 위 두 화면은 pending 저장본
  // cartReady 게이팅: CartProvider의 localStorage 로드는 부모 이펙트라 자식보다 늦는다 (직접 진입 레이스 방지)
  useEffect(() => {
    if (stage === "form" && !cartReady) return;
    if (stage !== "form") {
      const pending = loadPending();
      if (pending) {
        setLines(pending.items);
        setSource(pending.source || "cart");
        setForm(pending.form || form);
      }
      setLoaded(true);
      return;
    }
    const buyNow = takeBuyNow();
    if (buyNow) {
      setLines([buyNow]);
      setSource("buynow");
    } else {
      setLines(
        cartItems.map((i) => ({
          sku: i.sku, name: i.name, color: i.color, size: i.size,
          qty: i.qty, unit_price: i.unit_price, image: i.image,
        })),
      );
      setSource("cart");
    }
    // 회원 prefill은 별도 이펙트 (로그인 시점 변화에도 반응)
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, cartReady]);

  // 회원이면 계정 이메일을 주문 정보에 prefill — 사용자 수정 가능 (미션 §13)
  useEffect(() => {
    if (stage === "form" && authToken && authEmail) {
      setForm((f) => (f.email ? f : { ...f, email: authEmail }));
    }
  }, [stage, authToken, authEmail]);

  const subtotal = useMemo(() => lines.reduce((s, i) => s + i.unit_price * i.qty, 0), [lines]);
  const fee = getShippingFee(subtotal);
  const finalTotal = subtotal + fee;
  const methods = getPaymentMethods();

  const submitOrder = async () => {
    setSubmitting(true);
    setError("");
    try {
      const isMember = Boolean(authToken && form.email);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: form.name,
            phone: form.phone,
            address: form.address,
            depositor: form.depositor || form.name,
            email: isMember ? form.email : undefined,
            member: isMember,
          },
          items: lines.map((i) => ({ sku: i.sku, color: i.color, size: i.size, qty: i.qty })),
          source,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "주문 처리 실패");
        return;
      }
      // 주문 생성 성공 — 소스 비움 (재고는 서버가 이미 차감)
      if (source === "cart") clearCart();
      clearBuyNow();
      const pending: PendingOrder = {
        items: lines,
        form: { ...form, depositor: form.depositor || form.name },
        order_id: data.order_id,
        // 서버가 재계산한 상품 총액 + 동일 규칙의 배송비 (서버 total은 상품금만)
        total: data.total_amount + getShippingFee(data.total_amount),
        source,
        status: "입금 대기",
        splitNotice: data.shipping?.notice,
      };
      localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(pending));
      window.dispatchEvent(new Event("n1_order_update"));
      router.push("/checkout/payment");
    } catch {
      setError("서버 연결 실패 — 잠시 후 다시 시도해주세요");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeposit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: loadPending()?.order_id, name: form.name }),
      });
      const data = await res.json();
      if (!data.ok) {
        // 확인 요청 실패는 사실대로 안내 — 상태를 완료로 바꾸지 않는다
        setError("확인 요청이 접수되지 않았습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      const pending = loadPending();
      if (pending) {
        pending.status = "입금확인중";
        localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(pending));
      }
      window.dispatchEvent(new Event("n1_order_update"));
      router.push("/checkout/pending");
    } catch {
      setError("서버 연결 실패 — 잠시 후 다시 시도해주세요");
    } finally {
      setSubmitting(false);
    }
  };

  const copyAccount = () => {
    navigator.clipboard?.writeText(DEPOSIT.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ══════════ 화면 1: 상품 확인 → 정보 입력 → 결제 정보 → 최종 검토 ══════════
  if (stage === "form") {
    return (
      <main className="checkout-page">
        <h1 className="checkout-title">결제하기</h1>
        <div className="checkout-box">
          {!loaded ? (
            <p className="checkout-empty">불러오는 중</p>
          ) : lines.length === 0 ? (
            <p className="checkout-empty">
              결제할 상품이 없습니다.{" "}
              <Link href="/" className="checkout-link">컬렉션에서 상품을 선택해주세요 →</Link>
            </p>
          ) : (
            <>
              {/* ① 상품 확인 */}
              <section className="checkout-section">
                <h2 className="checkout-step">1 · 상품 확인{source === "buynow" ? " — 바로 구매" : ""}</h2>
                <div className="checkout-cart">
                  {lines.map((i, n) => (
                    <div className="checkout-item" key={`${i.sku}-${i.color}-${i.size}-${n}`}>
                      <span>
                        {i.name.slice(0, 24)} · {i.color ? colorDisplayLabel(i.color) : ""}
                        {i.size ? `${i.color ? " / " : ""}${i.size}` : ""} × {i.qty}
                      </span>
                      <b>{won(i.unit_price * i.qty)}</b>
                    </div>
                  ))}
                </div>
                {source === "buynow" && (
                  <p className="checkout-note">
                    바로 구매 상품만 결제합니다 — 장바구니의 다른 상품은 포함되지 않습니다.
                  </p>
                )}
              </section>

              {/* ② 주문자 / 배송 정보 */}
              <section className="checkout-section">
                <h2 className="checkout-step">2 · 주문자 · 배송 정보</h2>
                <div className="checkout-fields">
                  <input placeholder="주문자명" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <input placeholder="연락처 (010-0000-0000)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <input placeholder="배송지 주소" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  <input
                    placeholder={authToken ? "이메일 (회원 계정)" : "이메일 (선택 — 주문 조회용)"}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  <input placeholder="입금자명 (주문자명과 같으면 비워도 됨)" value={form.depositor} onChange={(e) => setForm({ ...form, depositor: e.target.value })} />
                </div>
                {authToken && (
                  <p className="checkout-note">회원 계정으로 주문합니다 — 주문 내역을 계정과 연결해 드려요.</p>
                )}
              </section>

              {/* ③ 결제 정보 — PG-ready 경계 */}
              <section className="checkout-section">
                <h2 className="checkout-step">3 · 결제 정보</h2>
                <div className="pay-methods" role="radiogroup" aria-label="결제 수단">
                  {methods.map((m) => (
                    <label
                      key={m.id}
                      className={`pay-method ${payMethod === m.id ? "on" : ""} ${m.available ? "" : "off"}`}
                    >
                      <input
                        type="radio"
                        name="pay-method"
                        value={m.id}
                        disabled={!m.available}
                        checked={payMethod === m.id}
                        onChange={() => m.available && setPayMethod(m.id)}
                      />
                      <span className="pay-name">
                        {m.name}
                        {!m.available && <em className="pay-wait"> — {m.unavailableReason}</em>}
                      </span>
                      <span className="pay-desc">{m.description}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* ④ 최종 주문 검토 */}
              <section className="checkout-section">
                <h2 className="checkout-step">4 · 최종 주문 검토</h2>
                <div className="checkout-total">
                  <span>상품금액 ({lines.reduce((s, i) => s + i.qty, 0)}개)</span><b>{won(subtotal)}</b>
                  <span>배송비</span><b>{fee ? won(fee) : "무료"}</b>
                  <span className="total-label">총 결제금액</span><b className="total-val">{won(finalTotal)}</b>
                </div>
                <label className="checkout-confirm">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  <span>주문 상품, 배송 정보, 결제 금액을 확인했습니다.</span>
                </label>
                {error && <p className="stock-alert">{error}</p>}
                <button
                  className="checkout-btn"
                  disabled={submitting || !reviewed || !form.name || !form.phone || !form.address || payMethod !== "bank_transfer"}
                  onClick={submitOrder}
                >
                  {submitting ? "처리 중..." : `주문 생성 → ${won(finalTotal)}`}
                </button>
                <p className="checkout-note">
                  주문 생성 후 무통장입금 안내로 이동합니다 — 재고·금액은 주문 생성 시점에 서버에서 최종 확인됩니다.
                </p>
              </section>
            </>
          )}
        </div>
      </main>
    );
  }

  // ══════════ 화면 2: 무통장입금 안내 ══════════
  if (stage === "payment") {
    const pending = lines.length ? null : loadPending();
    const total = pending?.total ?? finalTotal;
    return (
      <main className="checkout-page">
        <h1 className="checkout-title">주문 내역 확인 &amp; 계좌이체</h1>
        <div className="checkout-box">
          <div className="checkout-cart">
            {(lines.length ? lines : pending?.items || []).map((i, n) => (
              <div className="checkout-item" key={n}>
                <span>
                  {i.name.slice(0, 24)} · {i.color ? colorDisplayLabel(i.color) : ""}
                  {i.size ? `${i.color ? " / " : ""}${i.size}` : ""} × {i.qty}
                </span>
                <b>{won(i.unit_price * i.qty)}</b>
              </div>
            ))}
          </div>
          <div className="checkout-total">
            <span className="total-label">입금하실 금액</span><b className="total-val">{won(total)}</b>
          </div>

          <div className="deposit-emphasis">
            ⚠️ 계좌이체 완료 후 아래 [입금 완료 및 확인 요청] 버튼을 눌러주세요.<br />
            입금 계좌는 우측 하단 장바구니 아이콘의 <b>'결제 진행 현황'</b>에서도 언제든 다시 확인하실 수 있습니다.
          </div>

          <div className="deposit-box-lg">
            <div className="deposit-row"><span>은행</span><b>{DEPOSIT.bank}</b></div>
            <div className="deposit-row">
              <span>계좌번호</span>
              <b className="account-num">
                {DEPOSIT.account}
                <button className="copy-btn" onClick={copyAccount}>{copied ? "✓ 복사됨" : "복사"}</button>
              </b>
            </div>
            <div className="deposit-row"><span>예금주</span><b>{DEPOSIT.holder}</b></div>
            <div className="deposit-row"><span>입금자명</span><b>{form.depositor || form.name || "-"}</b></div>
            <div className="deposit-row highlight"><span>입금 금액</span><b>{won(total)}</b></div>
          </div>

          {error && <p className="stock-alert">{error}</p>}
          <button className="checkout-btn big" disabled={submitting} onClick={confirmDeposit}>
            {submitting ? "처리 중..." : "[ 입금 완료 및 확인 요청 ]"}
          </button>
        </div>
      </main>
    );
  }

  // ══════════ 화면 3: 입금 확인 중 ══════════
  const pending = loadPending();
  return (
    <main className="checkout-page">
      <div className="checkout-box pending-box">
        <div className="pending-icon">⏳</div>
        <h1 className="checkout-title">결제 확인 중입니다</h1>
        <p className="pending-text">
          입금 확인 후 순차적으로 처리됩니다. <br />
          확인이 완료되면 주문 상태가 <b>'결제 완료 및 출고 준비 중'</b>으로 전환됩니다.
        </p>
        <div className="deposit-box-lg">
          <div className="deposit-row"><span>주문번호</span><b>{pending?.order_id || "-"}</b></div>
          <div className="deposit-row"><span>입금 금액</span><b>{won(pending?.total ?? finalTotal)}</b></div>
          <div className="deposit-row"><span>입금 계좌</span><b>{DEPOSIT.bank} {DEPOSIT.account}</b></div>
        </div>
        <p className="buy-note">이 페이지를 닫아도 우측 하단 장바구니 아이콘의 '결제 진행 현황'에서 상태를 확인할 수 있습니다.</p>
      </div>
    </main>
  );
}
