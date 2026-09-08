/**
 * N°1 Cart — 순수 카트 로직 (V1 클라이언트 카트)
 *
 * 원칙:
 * - 라인 식별자는 원시(raw) 값 조합: sku + color + size (표시용 label과 분리 — 미션 §8)
 * - 동일 라인 재추가 시 수량 병합 (서버 상한과 동일한 1~10)
 * - mergeCarts(guest, member)는 deterministic: 같은 라인은 수량 합산(상한 캡),
 *   스냅샷은 더 이른 added_at 쪽 유지 — 향후 server cart sync 시에도 동일 계약 사용
 * - 가격은 스냅샷일 뿐이며 서버가 주문 시 재계산한다 (client 금액 신뢰 금지)
 */

export const MAX_QTY_PER_LINE = 10; // /api/orders 서버 캡과 동일

// ── Cart persistence contract (Session C) ──
// 활성 카트 = localStorage "n1_cart_v1" (게스트 — 기존 그대로, 하위호환 유지)
// 회원 카트 = localStorage "n1_cart_v1_m_<정규화된 이메일>" — 계정별 보관.
// 로그인 시점: 게스트 카트를 그대로 게스트 키에 보존 + mergeCarts(회원, 게스트) 결과를
// 회원 키에 저장하고 활성 카트로 전환. 로그아웃 시 게스트 보존본으로 복귀.
// → 게스트 카트는 절대 파괴되지 않고, 재로그인 시 mergeCarts 계약으로 재합성된다.
export const GUEST_CART_KEY = "n1_cart_v1";

export function sanitizeCartIdentity(email: string): string {
  return (email || "").trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

export function memberCartKey(email: string): string {
  return `${GUEST_CART_KEY}_m_${sanitizeCartIdentity(email)}`;
}

export interface CartItem {
  sku: string;
  name: string;
  color: string; // 원시 값 (PDP에서 선택한 그대로)
  size: string; // 원시 값
  qty: number;
  unit_price: number;
  image?: string;
  stock_snapshot?: number | null; // 담기 시점 옵션 재고 (표시 참고용 — 서버가 원본)
  added_at?: string;
}

/** 라인 고유 키 — 옵션 표시값이 아니라 원시 값으로만 동일성 판정 */
export function cartItemKey(item: Pick<CartItem, "sku" | "color" | "size">): string {
  return `${item.sku}::${item.color}::${item.size}`;
}

/** 원시 색상 값 → 표시 라벨 (experience.productColors와 동일 매핑) */
export function colorDisplayLabel(raw: string): string {
  return (raw || "").replace(/겨자/g, "머스타드");
}

function sanitizeQty(qty: number): number {
  const n = Math.floor(Number(qty) || 0);
  return Math.max(1, Math.min(MAX_QTY_PER_LINE, n));
}

/** 새 라인 추가 또는 동일 라인 수량 병합 (새 배열 반환 — 불변) */
export function addToCart(items: CartItem[], incoming: CartItem): CartItem[] {
  const key = cartItemKey(incoming);
  const now = new Date().toISOString();
  const next = items.map((it) => ({ ...it }));
  const existing = next.find((it) => cartItemKey(it) === key);
  if (existing) {
    existing.qty = Math.min(MAX_QTY_PER_LINE, existing.qty + sanitizeQty(incoming.qty));
  } else {
    next.push({ ...incoming, qty: sanitizeQty(incoming.qty), added_at: incoming.added_at || now });
  }
  return next;
}

export function removeFromCart(items: CartItem[], key: string): CartItem[] {
  return items.filter((it) => cartItemKey(it) !== key);
}

export function setLineQty(items: CartItem[], key: string, qty: number): CartItem[] {
  return items.map((it) =>
    cartItemKey(it) === key ? { ...it, qty: sanitizeQty(qty) } : it,
  );
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((s, it) => s + it.qty, 0);
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((s, it) => s + (Number(it.unit_price) || 0) * it.qty, 0);
}

/**
 * Guest Cart + Member Cart 병합 (로그인 시점).
 * - 라인 키가 같으면 수량 합산 (상한 캡)
 * - 스냅샷(unit_price/image/added_at)은 더 이른 added_at 우선, 동률 시 member 쪽
 * - 순서: member 라인 먼저, 그 뒤 guest 신규 라인 (deterministic)
 */
export function mergeCarts(member: CartItem[], guest: CartItem[]): CartItem[] {
  const out: CartItem[] = (member || []).map((it) => ({ ...it }));
  for (const g of guest || []) {
    const key = cartItemKey(g);
    const hit = out.find((it) => cartItemKey(it) === key);
    if (hit) {
      hit.qty = Math.min(MAX_QTY_PER_LINE, hit.qty + g.qty);
      const gTime = g.added_at || "";
      const hTime = hit.added_at || "";
      if (gTime && (!hTime || gTime < hTime)) {
        hit.unit_price = g.unit_price;
        hit.image = g.image ?? hit.image;
        hit.stock_snapshot = g.stock_snapshot ?? hit.stock_snapshot;
        hit.added_at = g.added_at;
      }
    } else {
      out.push({ ...g });
    }
  }
  return out;
}

/** localStorage 저장 형식 검증 — 손상/외부 변조 시 안전하게 폐기 */
export function parseCart(raw: string | null | undefined): CartItem[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (it: unknown): it is CartItem =>
          typeof it === "object" && it !== null &&
          typeof (it as CartItem).sku === "string" && (it as CartItem).sku !== "" &&
          typeof (it as CartItem).qty === "number",
      )
      .map((it: CartItem) => {
        const clean: CartItem = {
          sku: it.sku,
          name: String(it.name || it.sku),
          color: String(it.color || ""),
          size: String(it.size || ""),
          qty: sanitizeQty(it.qty),
          unit_price: Number(it.unit_price) || 0,
          added_at: typeof it.added_at === "string" ? it.added_at : undefined,
        };
        if (typeof it.image === "string" && it.image) clean.image = it.image;
        if (typeof it.stock_snapshot === "number") clean.stock_snapshot = it.stock_snapshot;
        return clean;
      });
  } catch {
    return [];
  }
}
