"use client";

/**
 * [상단 분할 글래스 유틸리티] — 문의 · 장바구니 (Storefront Repair §12·§22, 2026-09-10)
 *
 * 기존 하단 플로팅 FAB 2개(cs-fab · float-bar)를 대체하는 단일 컨트롤.
 * 세로로 긴 라운드 렌즈 — 중앙 수평 디바이더로 상하 두 개의 독립 터치 타깃:
 *   상단(말풍선) → 고객센터 (기존 n1:open-cs 이벤트 재사용 — 대화 상태 보존 §35)
 *   하단(쇼핑백) → 장바구니 드로어 (CartProvider 그대로 — 카트 상태 보존 §36)
 *
 * 위치: fixed overlay 좌상단 — N°1 브랜드 중앙을 밀지 않는다(§22).
 * 재질: C Perfume Liquid Glass(탭 렌즈와 같은 material family) — flat 회색·아이보리 필 금지.
 * 접근성: 두 버튼 각각 aria-label·focus-visible·키보드 동작.
 */
import { CartIcon, ChatIcon } from "./Icons";
import { useCart } from "./CartProvider";

export default function UtilityDock() {
  const { count, setOpen: setCartOpen } = useCart();

  const openCs = () => window.dispatchEvent(new Event("n1:open-cs"));
  const openCart = () => setCartOpen(true);

  return (
    <div className="util-dock" role="group" aria-label="문의 및 장바구니">
      <button
        type="button"
        className="util-dock-btn util-dock-top"
        onClick={openCs}
        aria-label="고객센터 문의 열기"
      >
        <ChatIcon size={15} />
      </button>
      <span className="util-dock-divider" aria-hidden="true" />
      <button
        type="button"
        className="util-dock-btn util-dock-bottom"
        onClick={openCart}
        aria-label={`장바구니 열기${count ? ` — ${count}개 상품` : ""}`}
      >
        <CartIcon size={15} />
        {count > 0 && <span className="util-dock-count">{count}</span>}
      </button>
    </div>
  );
}
