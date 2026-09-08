/**
 * N°1 Stock Integration Boundary — 공급사 재고 연계 경계 (Session C, 미션 §11)
 *
 * 이 세션에서는 **인터페이스만** 정의한다. 실제 공급사(도매꾹) 재고 백엔드는 Session B
 * (lib/stock/* — 무접촉), 실제 Checkout 연결은 Session H.
 *
 * 배치 노트: Session B가 lib/stock/ 네임스페이스(공급사 데이터 정규화)를 사용 중이므로
 * 본 경계는 lib/supplierStock.ts 로 분리했다 — 양쪽이 한 네임스페이스를 두고 겹치지 않는다.
 *
 * 계약:
 * - getStockAdapter(): 등록된 어댑터가 없으면 noop 어댑터를 돌려주며, 그 응답은
 *   definitive: false ("알 수 없음") — 재고를 날조하지 않는다. 호출자는
 *   definitive:false 이면 자체 원본(Orders/Products 시트 옵션별재고) 확인으로 폴백해야 한다.
 * - Session B 가 공급사 백엔드를 만들면 registerStockAdapter() 로 주입,
 *   Session H 가 checkout 흐름에서 finalStockCheck() 를 호출해 주문 확정 전 마지막
 *   재고 확인으로 물린다.
 */

export interface StockCheckLine {
  sku: string;
  color: string; // 원시 값
  size: string; // 원시 값
  qty: number;
}

export interface StockAvailability {
  sku: string;
  color: string;
  size: string;
  requested: number;
  /** 공급사가 수량을 못 주면 null — 존재하지 않는 옵션과 미확인을 구분하지 않는다(정직). */
  available: number | null;
  /** null = 미확정. 확정이면 boolean. */
  ok: boolean | null;
  note?: string;
}

export interface StockCheckResult {
  /** 미확정이면 null (어댑터 없음/조회 실패) — false 는 "품절 확정"만 쓴다. */
  ok: boolean | null;
  /** true 인 경우에만 ok 를 신뢰해 주문을 막을 수 있다. */
  definitive: boolean;
  lines: StockAvailability[];
  adapter: string;
  checkedAt: string;
  error?: string;
}

export interface StockAdapter {
  /** 어댑터 식별자 — 로그/CS 대장 기록용 (예: "domaekak_openapi_v1") */
  readonly name: string;
  checkAvailability(lines: StockCheckLine[]): Promise<StockCheckResult>;
  /**
   * 선택 계약 — 주문 확정 시 공급사 재고 예약/확보. 미구현 어댑터는 무시 가능.
   * Session H 가 호출 시점을 결정한다. 실패해도 주문 자체를 막지 않는다(폴백 원본 재검증).
   */
  reserve?(orderRef: { orderId: string; lines: StockCheckLine[] }): Promise<StockCheckResult>;
}

/** 기본 어댑터 — 아무것도 조회하지 않고 정직하게 "미확정"만 반환 */
export const noopSupplierStockAdapter: StockAdapter = {
  name: "noop",
  async checkAvailability(lines: StockCheckLine[]): Promise<StockCheckResult> {
    return {
      ok: null,
      definitive: false,
      adapter: this.name,
      checkedAt: new Date().toISOString(),
      lines: lines.map((l) => ({
        sku: l.sku,
        color: l.color,
        size: l.size,
        requested: l.qty,
        available: null,
        ok: null,
        note: "공급사 재고 어댑터 미연결 — 원본(시트) 재고로 확인 필요",
      })),
    };
  },
};

declare global {
  // eslint-disable-next-line no-var
  var __n1_stock_adapter: StockAdapter | undefined;
}

/** Session B/H 가 실제 어댑터를 주입하는 유일한 지점 */
export function registerStockAdapter(adapter: StockAdapter): void {
  global.__n1_stock_adapter = adapter;
}

export function getStockAdapter(): StockAdapter {
  return global.__n1_stock_adapter ?? noopSupplierStockAdapter;
}

/**
 * finalStockCheck — 주문 확정 전 마지막 재고 확인의 단일 진입점.
 * Session H 연결 시 호출부가 이 함수만 쓰면 어댑터 교체가 자동 반영된다.
 */
export async function finalStockCheck(lines: StockCheckLine[]): Promise<StockCheckResult> {
  const adapter = getStockAdapter();
  try {
    return await adapter.checkAvailability(lines);
  } catch (e: unknown) {
    // 조회 실패 = 미확정 (품절로 판정하지 않는다)
    return {
      ok: null,
      definitive: false,
      adapter: adapter.name,
      checkedAt: new Date().toISOString(),
      lines: lines.map((l) => ({
        sku: l.sku,
        color: l.color,
        size: l.size,
        requested: l.qty,
        available: null,
        ok: null,
      })),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
