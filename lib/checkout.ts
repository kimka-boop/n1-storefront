/**
 * N°1 Checkout 공용 로직 — 배송비 규칙 + Buy Now stash (미션 §6·§9)
 *
 * BUY NOW: 장바구니의 다른 상품을 포함하지 않고 현재 선택만 결제로 진행한다.
 * stash는 sessionStorage — 탭 세션 동안만 유효(브라우저 재시작 시 소멸이 자연스러움).
 */
import { CartItem } from "@/lib/cart";

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_OVER = 50000;

export function getShippingFee(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
}

export function calcTotal(subtotal: number): number {
  return subtotal + getShippingFee(subtotal);
}

const BUY_NOW_KEY = "n1_buy_now";

export function stashBuyNow(item: CartItem): void {
  try {
    sessionStorage.setItem(BUY_NOW_KEY, JSON.stringify({ item, ts: new Date().toISOString() }));
  } catch {}
}

export function takeBuyNow(): CartItem | null {
  try {
    const raw = sessionStorage.getItem(BUY_NOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const item = parsed?.item;
    if (!item || typeof item.sku !== "string" || !item.sku) return null;
    return {
      sku: item.sku,
      name: String(item.name || item.sku),
      color: String(item.color || ""),
      size: String(item.size || ""),
      qty: Math.max(1, Math.min(10, Number(item.qty) || 1)),
      unit_price: Number(item.unit_price) || 0,
      image: typeof item.image === "string" ? item.image : undefined,
      stock_snapshot: typeof item.stock_snapshot === "number" ? item.stock_snapshot : null,
    };
  } catch {
    return null;
  }
}

export function clearBuyNow(): void {
  try {
    sessionStorage.removeItem(BUY_NOW_KEY);
  } catch {}
}
