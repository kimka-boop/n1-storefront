"use client";

/**
 * [카트 드로어] 장바구니 아이콘 클릭 → 실제 카트 경험 (미션 §3)
 * - guest/member 공용 (CartProvider)
 * - 라인: 이미지 · 상품명 · color · size · 수량(±) · 단가 · 합계 · 삭제
 * - 원시(raw) 옵션 값 보존 — 표시 라벨만 렌더 시점 변환 (미션 §8)
 * - 결제하기 → /checkout (cart 전체)
 * - 스타일: 중립 UI — Liquid Glass 재질 정의는 Glass Lab 영역 (미션 §53)
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { cartItemKey, colorDisplayLabel } from "@/lib/cart";
import { getShippingFee, clearBuyNow } from "@/lib/checkout";

export default function CartDrawer() {
  const { items, ready, open, setOpen, remove, setQty, subtotal, count } = useCart();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  // 빈 카트에서도 '결제 진행 현황' 경로 유지 — 하단 플로팅 바 제거(§12)의 보완
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem("n1_pending_order");
      const d = raw ? JSON.parse(raw) : null;
      setHasPending(Boolean(d && d.order_id && Array.isArray(d.items)));
    } catch {
      setHasPending(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onTracker = () => setOpen(false); // 결제 진행 현황 팝업이 열리면 드로어 닫음
    window.addEventListener("n1:open-order-tracker", onTracker);
    return () => window.removeEventListener("n1:open-order-tracker", onTracker);
  }, [open, setOpen]);

  if (!ready || !open) return null;

  const fee = getShippingFee(subtotal);

  const openTracker = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    setTimeout(() => window.dispatchEvent(new Event("n1:open-order-tracker")), 60);
  };

  const goCheckout = () => {
    setOpen(false);
    clearBuyNow(); // 카트 결제 의도 — 남은 바로 구매 stash가 소스를 가로채지 않게 한다
    router.push("/checkout");
  };

  return (
    <div className="cart-overlay" onClick={() => setOpen(false)}>
      <div
        ref={panelRef}
        className="cart-panel"
        role="dialog"
        aria-label="장바구니"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cart-head">
          <b>장바구니{count ? ` (${count})` : ""}</b>
          <button className="cart-close" onClick={() => setOpen(false)} aria-label="장바구니 닫기">✕</button>
        </div>

        {items.length === 0 ? (
          <div className="cart-empty">
            <p>장바구니가 비어 있습니다.</p>
            <Link href="/" className="cart-empty-link" onClick={() => setOpen(false)}>
              컬렉션 보러가기 →
            </Link>
            {hasPending && (
              <p className="cart-meta">
                <button className="cart-linklike" onClick={openTracker}>결제 진행 현황 확인 →</button>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="cart-lines">
              {items.map((it) => {
                const key = cartItemKey(it);
                const soldOutSnap = it.stock_snapshot === 0;
                return (
                  <div className="cart-line" key={key}>
                    {it.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="cart-line-img" src={it.image} alt="" loading="lazy" />
                    ) : (
                      <span className="cart-line-img empty" aria-hidden="true" />
                    )}
                    <div className="cart-line-body">
                      <p className="cart-line-name">{it.name}</p>
                      <p className="cart-line-opts">
                        {it.color ? colorDisplayLabel(it.color) : ""}
                        {it.size ? `${it.color ? " / " : ""}${it.size}` : ""}
                      </p>
                      <div className="cart-line-ctrl">
                        <div className="cart-qty" role="group" aria-label="수량 변경">
                          <button onClick={() => setQty(key, it.qty - 1)} disabled={it.qty <= 1} aria-label="수량 줄이기">−</button>
                          <span>{it.qty}</span>
                          <button onClick={() => setQty(key, it.qty + 1)} disabled={it.qty >= 10} aria-label="수량 늘리기">＋</button>
                        </div>
                        <b className="cart-line-price">₩{(it.unit_price * it.qty).toLocaleString("ko-KR")}</b>
                        <button className="cart-remove" onClick={() => remove(key)} aria-label="상품 삭제">삭제</button>
                      </div>
                      {soldOutSnap && (
                        <p className="cart-line-note">담기 시점 기준 해당 옵션 재고가 없습니다 — 주문 시 확인됩니다.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cart-summary">
              <div><span>상품금액</span><b>₩{subtotal.toLocaleString("ko-KR")}</b></div>
              <div><span>배송비</span><b>{fee ? `₩${fee.toLocaleString("ko-KR")}` : "무료"}</b></div>
              <div className="cart-total"><span>총 결제금액</span><b>₩{(subtotal + fee).toLocaleString("ko-KR")}</b></div>
            </div>

            <button className="cart-checkout-btn" onClick={goCheckout}>
              결제하기 →
            </button>
            <p className="cart-meta">
              주문 시점에 서버에서 재고·금액이 최종 확인됩니다.
              · <button className="cart-linklike" onClick={openTracker}>결제 진행 현황</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
