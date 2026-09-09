/**
 * N°1 PDP 재고 표시 — 순수 파생 로직 (SESSION H, TASKS 11·14)
 *
 * 계약 (B 리포트 §6 Session H 통합 규칙과 1:1):
 * - "N개 남음"은 **검증된 숫자(TYPE A) 옵션 재고**에만 표시한다. Binary/unknown에서는
 *   숫자를 만들지 않는다 (countLabel = null) — 0으로의 창작 금지.
 * - 신선도는 stock_verified_at 기준으로 여기서 다시 판정한다(freshnessOf) — 오래 열려 있던
 *   페이지에서 STALE 값이 숫자로 남아 있는 것을 방지 (TASK H3).
 * - 판매 가능/품절 판정은 서버 게이트(lib/stockGate + 어댑터)와 같은 규칙을 쓴다:
 *   확인된 품절(available=false·수량 0·판매종료)만 품절, 그 외 미확인은 조용한 CS 안내.
 * - 구매 가능은 "FRESH + 확인된 숫자(옵션 또는 상품 단위) ≥ 1"일 때만 — 서버가 수락할
 *   주문만 PDP에서 활성화한다 (미확인 바이러스: 버튼은 열려 있는데 서버가 거절하는 부정합 금지).
 */
import { buildOptionKey, freshnessOf } from "@/lib/stock/normalize";

/** /api/stock(n1.stock.v1) 응답 레코드 중 PDP가 소비하는 필드만 (클라이언트 경량 뷰) */
export interface StockViewLite {
  productId: string;
  stockStatus?: string;
  stockQuantity?: number | null;
  stockType?: string;
  stockVerifiedAt?: string | null;
  optionStock?: Array<{
    optionKey: string;
    color: string;
    size: string;
    quantity: number | null;
    available: boolean | null;
  }>;
}

export interface PdpStockState {
  /** /api/stock 조회 자체의 성공/실패 — 실패는 미확인과 다른 별도 fallback (TASK H7) */
  lookup: "ok" | "failed";
  /** 검증된 숫자 옵션 재고. null = 숫자 없음(미확인·binary·stale — 표시 금지) */
  count: number | null;
  /** "N개 남음" — count ≥ 1일 때만. 그 외 null (TASK H1·H2) */
  countLabel: string | null;
  /** 확인된 품절 (available=false / 수량 0 / 판매종료) — stale은 품절이 아니다 */
  soldout: boolean;
  /** FRESH + 확인된 숫자 ≥ 1 — 서버 finalStockCheck가 수락할 선택 */
  buyable: boolean;
  /** 수량 선택 상한 — 확인된 수량으로 cap (미확인이면 기본 10) */
  capQty: number;
  /** stock_verified_at 기반 신선도 (STALE이면 count 숨김의 근거) */
  fresh: boolean;
  /** 선택 색상에서 확인된 사이즈 목록(원본 순서) — 시트 sizeOptions이 비어 있을 때 옵션 완성 */
  sizes: string[];
}

/** /api/stock 조회 실패 시 고객에게 보여주는 truthful fallback — 기존 "확인 중" copy와 다름 (TASK 14) */
export const STOCK_LOOKUP_FAILURE_NOTE = "재고 정보를 불러오지 못했습니다 — 잠시 후 새로고침해 주세요.";

const NEUTRAL_FAILED: PdpStockState = {
  lookup: "failed",
  count: null,
  countLabel: null,
  soldout: false,
  buyable: false,
  capQty: 10,
  fresh: false,
  sizes: [],
};

const NEUTRAL_OK: PdpStockState = {
  lookup: "ok",
  count: null,
  countLabel: null,
  soldout: false,
  buyable: false,
  capQty: 10,
  fresh: false,
  sizes: [],
};

/** PDP 선택 옵션의 재고 표시 상태 (TASK 11 — option selector 아래 작은 metadata의 데이터원) */
export function pdpStockState(
  view: StockViewLite | null | undefined,
  lookupFailed: boolean,
  color: string,
  size: string,
  now: Date = new Date(),
): PdpStockState {
  if (lookupFailed) return { ...NEUTRAL_FAILED };
  if (!view) return { ...NEUTRAL_OK };

  // 신선도 재판정 — API가 준 fresh 플래그가 아니라 원시 stock_verified_at으로 지금 판정한다
  const fresh = freshnessOf(view.stockVerifiedAt ?? null, now) === "FRESH";
  if (!fresh) {
    // STALE/UNKNOWN 검증값 — 숫자가 있어도 count를 숨긴다 (TASK H3). 품절로도 만들지 않는다.
    return { ...NEUTRAL_OK };
  }

  // 사이즈 후보 — 선택 색상(또는 무색상 엔트리)의 확인된 행에서 수집
  const c = (color || "").trim();
  const sizes: string[] = [];
  for (const e of view.optionStock ?? []) {
    if (!e.size || e.size.trim() === "") continue;
    if (e.color === c || e.color === "") {
      if (!sizes.includes(e.size)) sizes.push(e.size);
    }
  }

  // 상품 단위 확인 사실 — 판매종료는 옵션과 무관하게 품절 (어댑터와 동일)
  if (view.stockStatus === "판매종료") {
    return { ...NEUTRAL_OK, fresh: true, sizes };
  }

  const entry = (view.optionStock ?? []).find((e) => e.optionKey === buildOptionKey(color, size));
  if (entry) {
    if (entry.available === false) {
      return { ...NEUTRAL_OK, fresh: true, sizes, soldout: true }; // binary 품절 — 숫자 없음 (H2)
    }
    if (typeof entry.quantity === "number") {
      if (entry.quantity <= 0) return { ...NEUTRAL_OK, fresh: true, sizes, soldout: true };
      return {
        lookup: "ok",
        count: entry.quantity,
        countLabel: `${entry.quantity}개 남음`,
        soldout: false,
        buyable: true,
        capQty: Math.max(1, Math.min(10, entry.quantity)),
        fresh: true,
        sizes,
      };
    }
    // binary available(수량 미확인) — 숫자 없음, 구매 확정 불가 → 조용한 CS 안내
    return { ...NEUTRAL_OK, fresh: true, sizes };
  }

  // 옵션 행이 없을 때 상품 단위 수량으로 판정 (서버 어댑터와 동일 규칙)
  if (typeof view.stockQuantity === "number") {
    if (view.stockQuantity <= 0) return { ...NEUTRAL_OK, fresh: true, sizes, soldout: true };
    return {
      lookup: "ok",
      count: null, // 상품 단위 수량 — "옵션" 숫자가 아니므로 count 표시는 하지 않는다
      countLabel: null,
      soldout: false,
      buyable: true,
      capQty: Math.max(1, Math.min(10, view.stockQuantity)),
      fresh: true,
      sizes,
    };
  }
  return { ...NEUTRAL_OK, fresh: true, sizes };
}

export type EffectiveBuy = "ready" | "choose" | "soldout" | "unconfirmed";

/**
 * PDP 구매 CTA 상태 — B 재고 파이프라인 판정을 우선하고, 확인 데이터가 없을 때만
 * 기존 purchaseState(Products 시트 옵션별재고) 폴백을 쓴다.
 */
export function effectiveBuyState(
  sheetBuy: EffectiveBuy,
  stock: PdpStockState,
  sizeChoices: string[],
  selSize: string,
): EffectiveBuy {
  if (stock.soldout) return "soldout";
  if (stock.lookup === "failed") return "unconfirmed";
  if (stock.buyable) {
    // 사이즈를 골라야 옵션이 확정된다 — 미선택이면 choose
    return sizeChoices.length > 1 && !selSize ? "choose" : "ready";
  }
  return sheetBuy;
}
