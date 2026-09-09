import OrderReturns from "@/components/OrderReturns";

export const metadata = {
  title: "주문 조회 · 반품/교환 — N°1",
  description: "주문 확인과 반품·교환 요청",
};

/** [주문 조회 · 반품/교환] Session I — 회원 주문내역 / 게스트 검증 조회 → 반품·교환 요청 */
export default function OrdersPage() {
  return (
    <main>
      <OrderReturns />
    </main>
  );
}
