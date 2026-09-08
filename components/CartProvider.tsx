"use client";

/**
 * [카트 컨텍스트] guest/member 공용 클라이언트 카트 (V1)
 * - localStorage "n1_cart_v1" — 브라우저 refresh/네비게이션에 유지 (미션 §4)
 * - 로그인/로그아웃과 무관하게 카트를 잃지 않는다 (미션 §5 — 게스트 카트 보존)
 * - 탭 간 동기화(storage event)
 * - 서버 카트 persistence가 생기면 mergeCarts(lib/cart.ts) 계약으로 합성
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  addToCart,
  cartCount,
  cartSubtotal,
  parseCart,
  removeFromCart,
  setLineQty,
  CartItem,
} from "@/lib/cart";

const CART_KEY = "n1_cart_v1";

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

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setItems(parseCart(localStorage.getItem(CART_KEY)));
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_KEY) setItems(parseCart(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const add = useCallback((item: CartItem) => {
    persist(addToCart(parseCart(localStorage.getItem(CART_KEY)), item));
  }, [persist]);

  const remove = useCallback((key: string) => {
    persist(removeFromCart(parseCart(localStorage.getItem(CART_KEY)), key));
  }, [persist]);

  const setQty = useCallback((key: string, qty: number) => {
    persist(setLineQty(parseCart(localStorage.getItem(CART_KEY)), key, qty));
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
