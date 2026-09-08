"use client";

/**
 * [카트 컨텍스트] guest/member 공용 클라이언트 카트 (V1)
 * - localStorage "n1_cart_v1" — 브라우저 refresh/네비게이션에 유지 (미션 §4)
 * - 로그인/로그아웃과 무관하게 카트를 잃지 않는다 (미션 §5 — 게스트 카트 보존)
 * - 탭 간 동기화(storage event)
 *
 * [Session C — Cart persistence contract]
 * - 활성 카트는 신원(identity)을 따라간다: 게스트 "n1_cart_v1" ↔ 회원 "n1_cart_v1_m_<email>"
 * - 로그인: 현재(게스트) 카트를 게스트 키에 그대로 보존한 뒤 mergeCarts(회원, 게스트)를
 *   회원 키에 적용 — 게스트 카트는 파괴되지 않는다
 * - 로그아웃: 회원 카트를 회원 키에 유지한 채 게스트 보존본으로 복귀
 * - AuthProvider(auth core)는 수정하지 않고, token/email 변화만 관찰한다
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  addToCart,
  cartCount,
  cartSubtotal,
  GUEST_CART_KEY,
  memberCartKey,
  mergeCarts,
  parseCart,
  removeFromCart,
  setLineQty,
  CartItem,
} from "@/lib/cart";
import { useAuth } from "@/components/AuthProvider";

interface CartState {
  items: CartItem[];
  count: number;
  subtotal: number;
  ready: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (item: CartItem) => void;
  remove: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
}

const CartCtx = createContext<CartState>({
  items: [], count: 0, subtotal: 0, ready: false, open: false,
  setOpen: () => {}, add: () => {}, remove: () => {}, setQty: () => {}, clear: () => {},
});

function readKey(key: string): CartItem[] {
  try {
    return parseCart(localStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeKey(key: string, items: CartItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {}
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const { token, email, ready: authReady } = useAuth();
  const activeKeyRef = useRef<string>(GUEST_CART_KEY);

  // ── 신원 전환 (게스트 ↔ 회원): mergeCarts 계약으로 카트 이동 ──
  useEffect(() => {
    if (!ready || !authReady) return;
    const memberKey = token && email ? memberCartKey(email) : null;

    if (memberKey && activeKeyRef.current !== memberKey) {
      // 로그인 — 게스트 보존 → 회원 카트와 병합 → 활성 전환
      const guestItems = readKey(GUEST_CART_KEY);
      const memberItems = readKey(memberKey);
      writeKey(GUEST_CART_KEY, guestItems); // 로그아웃 복귀용 보존 (파괴 금지)
      const merged = mergeCarts(memberItems, guestItems);
      writeKey(memberKey, merged);
      activeKeyRef.current = memberKey;
      setItems(merged);
      return;
    }
    if (!token && activeKeyRef.current !== GUEST_CART_KEY) {
      // 로그아웃 — 회원 카트는 회원 키에 유지, 게스트 보존본으로 복귀
      const guestItems = readKey(GUEST_CART_KEY);
      activeKeyRef.current = GUEST_CART_KEY;
      setItems(guestItems);
      return;
    }
    if (activeKeyRef.current === GUEST_CART_KEY && items.length === 0 && !token) {
      // 초기 로드 (게스트)
      const guestItems = readKey(GUEST_CART_KEY);
      if (guestItems.length) setItems(guestItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authReady, token, email]);

  useEffect(() => {
    setItems(readKey(GUEST_CART_KEY));
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === activeKeyRef.current) setItems(readKey(e.key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    writeKey(activeKeyRef.current, next);
  }, []);

  const add = useCallback((item: CartItem) => {
    persist(addToCart(readKey(activeKeyRef.current), item));
  }, [persist]);

  const remove = useCallback((key: string) => {
    persist(removeFromCart(readKey(activeKeyRef.current), key));
  }, [persist]);

  const setQty = useCallback((key: string, qty: number) => {
    persist(setLineQty(readKey(activeKeyRef.current), key, qty));
  }, [persist]);

  const clear = useCallback(() => persist([]), [persist]);

  const value = useMemo<CartState>(
    () => ({
      items, ready, open, setOpen, add, remove, setQty, clear,
      count: cartCount(items),
      subtotal: cartSubtotal(items),
    }),
    [items, ready, open, add, remove, setQty, clear],
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => useContext(CartCtx);
