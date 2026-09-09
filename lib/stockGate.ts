/**
 * N°1 Stock Gate — 주문 확정 직전 재고 판정의 순수 로직 (SESSION H, TASKS 11·13·14)
 *
 * 결제 개시 직전(/api/orders 생성 경로)에 내리는 판정만 담는다. I/O 없음 — 시트·원장 접근은
 * lib/stockCheckout.ts(서버 배선)이, 화면 표시는 lib/stockDisplay.ts(PDP)가 담당한다.
 *
 * 정직 계약 (미션 §2·§11):
 * - "품절"은 확인된 품절만 말한다. 미확인(null)은 미확인으로 안내한다 — 0으로 창작 금지.
 * - B 파이프라인(finalStockCheck)의 판정은 definitive일 때만 신뢰해 주문을 막는다.
 * - 차감은 "주문 차감"으로 기록한다 — 예약/확보를 주장하지 않는다 (확보한 적 없음, TASK H8).
 */
import { StockRecord } from "@/lib/stock/types";
import { buildOptionKey } from "@/lib/stock/normalize";
import { StockCheckResult } from "@/lib/supplierStock";

/** 게이트 판정 대상 라인 — 서버 resolved 주문행과 1:1 */
export interface GateLine {
  sku: string;
  color: string;
  size: string;
  qty: number;
  name?: string;
}

export type GateBlockReason = "SOLDOUT" | "INSUFFICIENT" | "UNCONFIRMED";

export interface StockGateOutcome {
  ok: boolean;
  /** 판정 출처 — B 파이프라인(Stock_Staging/원장) 또는 C 원본(Products 옵션별재고) 폴백 */
  source: "stock-pipeline" | "products-sheet";
  /** stock-pipeline 판정에서만 의미 — true면 어댑터가 확정 판정했다 */
  definitive: boolean;
  blockReason?: GateBlockReason;
  blockedLine?: GateLine;
  /** 차단 라인의 확인된 잔여 수량. null = 수량 미확인 (UNCONFIRMED) */
  remaining?: number | null;
  /** ok면 빈 문자열. 실패 메시지는 그대로 고객에게 노출된다 (truthful copy) */
  message: string;
}

function lineLabel(l: GateLine): string {
  const opt = l.color && l.size ? ` ${l.color}/${l.size}` : l.color || l.size ? ` ${l.color || l.size}` : "";
  return `${l.name || l.sku}${opt}`;
}

export const GATE_MSG = {
  soldout: (l: GateLine) => `품절: ${lineLabel(l)} — 확인된 재고가 없어 결제를 진행하지 못했습니다`,
  insufficient: (l: GateLine, remaining: number) => `재고 부족: ${lineLabel(l)} — 잔여 ${remaining}개`,
  unconfirmed: (l: GateLine) =>
    `재고 미확인: ${lineLabel(l)} — 이 옵션의 재고가 아직 확인되지 않았습니다 (품절이 아님)`,
} as const;

/**
 * finalStockCheck 결과 → 게이트 판정.
 * 어댑터가 미확정(definitive:false)이면 null을 돌려준다 — 호출자는 C 원본(Products 시트)으로
 * 폴백해야 한다 (lib/supplierStock.ts 계약). 확정 품절/수량부족만 주문을 막는다.
 */
export function gateFromStockCheck(check: StockCheckResult, lines: GateLine[]): StockGateOutcome | null {
  if (!check.definitive) return null;
  if (check.ok !== false) {
    return { ok: true, source: "stock-pipeline", definitive: true, message: "" };
  }
  const idx = check.lines.findIndex((l) => l.ok === false);
  const bad = idx === -1 ? null : check.lines[idx];
  const matched = idx === -1 ? undefined : lines[idx];
  const line: GateLine = bad
    ? {
        sku: bad.sku,
        color: bad.color,
        size: bad.size,
        qty: bad.requested,
        name: matched?.name,
      }
    : { ...lines[0] };
  const remaining = bad && typeof bad.available === "number" ? bad.available : null;
  const reason: GateBlockReason = remaining === 0 ? "SOLDOUT" : "INSUFFICIENT";
  return {
    ok: false,
    source: "stock-pipeline",
    definitive: true,
    blockReason: reason,
    blockedLine: line,
    remaining,
    message: reason === "SOLDOUT" ? GATE_MSG.soldout(line) : GATE_MSG.insufficient(line, remaining ?? 0),
  };
}

/**
 * C 원본 폴백 판정 — Products 시트 `옵션별재고`(k:v|k:v)에서 정확히 일치하는 옵션 키만 읽는다.
 * 규약상 키가 없으면 미확인으로 차단한다(품절로 창작 금지). 근사 키 추론(max 히uristic)은
 * SESSION H에서 제거했다 — 확인된 값만 판정에 쓴다.
 */
export function gateFromSheetStock(
  lines: GateLine[],
  sheetQtyOf: (line: GateLine) => number | undefined,
): StockGateOutcome {
  for (const line of lines) {
    const n = sheetQtyOf(line);
    if (n === undefined || !Number.isFinite(n)) {
      return {
        ok: false,
        source: "products-sheet",
        definitive: false,
        blockReason: "UNCONFIRMED",
        blockedLine: line,
        remaining: null,
        message: GATE_MSG.unconfirmed(line),
      };
    }
    if (n < line.qty) {
      const reason: GateBlockReason = n === 0 ? "SOLDOUT" : "INSUFFICIENT";
      return {
        ok: false,
        source: "products-sheet",
        definitive: false,
        blockReason: reason,
        blockedLine: line,
        remaining: n,
        message: reason === "SOLDOUT" ? GATE_MSG.soldout(line) : GATE_MSG.insufficient(line, n),
      };
    }
  }
  return { ok: true, source: "products-sheet", definitive: false, message: "" };
}

/** 차감 비고에 남기는 근거 문자열 — "예약/확보"가 아닌 "주문 차감"이 원인을 정확히 말한다 */
export const DECREMENT_NOTE = (orderId: string, key: string, qty: number) =>
  `주문 차감 ${orderId} ${key} -${qty}`;

const MAX_NOTES = 6;

/**
 * 주문 확정 후 검증 레코드에 차감을 적용하는 순수 계산.
 * - 확인된 숫자(quantity)만 차감한다. 미확인(null)은 그대로 둔다 — 숫자를 만들지 않는다.
 * - 재고검증일시(stockVerifiedAt)는 건드리지 않는다: 값의 근거(공급처 검증 시각)는 차감으로
 *   바뀌지 않으며, 파생 사실은 비고(notes)의 "주문 차감" 기록으로만 남는다.
 */
export function applyOrderDecrement(
  record: StockRecord,
  lines: GateLine[],
  orderId: string,
): { record: StockRecord; changed: boolean } {
  let changed = false;
  const optionStock = record.optionStock.map((e) => ({ ...e }));
  const byKey = new Map(optionStock.map((e) => [e.optionKey, e] as const));
  const newNotes: string[] = [];
  let productTotal = 0;
  for (const l of lines) {
    const key = buildOptionKey(l.color, l.size) || record.productId;
    const entry = byKey.get(key);
    if (entry && typeof entry.quantity === "number") {
      entry.quantity = Math.max(0, entry.quantity - l.qty);
      changed = true;
    }
    productTotal += l.qty;
    newNotes.push(DECREMENT_NOTE(orderId, key, l.qty));
  }
  let stockQuantity = record.stockQuantity;
  if (typeof stockQuantity === "number") {
    stockQuantity = Math.max(0, stockQuantity - productTotal);
    changed = true;
  }
  const notes = [...(record.notes ?? []), ...newNotes].slice(-MAX_NOTES);
  return { record: { ...record, optionStock, stockQuantity, notes }, changed };
}
