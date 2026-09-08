/**
 * N°1 Stock Backend → supplierStock 경계 어댑터 (Session C가 남긴 registerStockAdapter 주입점)
 *
 * Session C의 StockAdapter 계약(lib/supplierStock.ts)을 Session B의 검증 원장으로 구현한다.
 * - 결제 시점에 공급처를 실시간 호출하지 않는다 — watcher가 검증해 둔 원장(Staging/ledger) 값을 읽고
 *   freshness로 확정성을 판정한다. 실시간 재확인이 필요하면 Session H가 /api/stock?skus= 를 쓰거나
 *   HERMES bridge 프로브를 트리거한다 (cadence 정책 위반 방지 — 미션 §6).
 * - 확정(definitive) 규칙: FRESH한 검증값이면서 수량 또는 품절이 확인된 라인만. STALE/미검증은
 *   definitive:false — "품절"로 판정하지 않는다 (null 수량을 0으로 취급 금지).
 * - 옵션 키 규약은 buildOptionKey(color,size) — /api/orders·purchaseState와 동일.
 */
import { StockRecord } from "./types";
import { buildOptionKey, freshnessOf } from "./normalize";
import type { StockAdapter, StockAvailability, StockCheckLine, StockCheckResult } from "../supplierStock";

const ADAPTER_NAME = "n1-stock-backend.v1";

/** 검증 원장 로딩 — 시트 Staging은 이 어댑터에서 읽지 않는다(Next 서버 시트 의존 분리).
 *  Session H가 어댑터 주입 시 원장 로더를 넘기는 구성을 권장. 기본은 파일 원장. */
export type StockLedgerLoader = () => Promise<Record<string, StockRecord>>;

export function createStockBackendAdapter(loadLedger: StockLedgerLoader, now: Date = new Date()): StockAdapter {
  return {
    name: ADAPTER_NAME,
    async checkAvailability(lines: StockCheckLine[]): Promise<StockCheckResult> {
      const ledger = await loadLedger();
      const checked: StockAvailability[] = [];
      let allDefinitive = true;
      let anyBlocked = false;
      for (const line of lines) {
        const rec: StockRecord | undefined = ledger[line.sku];
        if (!rec || !rec.stockVerifiedAt || freshnessOf(rec.stockVerifiedAt, now) !== "FRESH") {
          allDefinitive = false;
          checked.push({
            sku: line.sku,
            color: line.color,
            size: line.size,
            requested: line.qty,
            available: null,
            ok: null,
            note: rec ? "재고 검증분이 STALE — 재검증 필요" : "검증된 재고 없음 (NOT_STAGED)",
          });
          continue;
        }
        // 상품 단위 확정: 수량 확인분은 숫자로, 없으면 옵션 판정으로 내려간다
        if (rec.stockStatus === "판매종료") {
          anyBlocked = true;
          checked.push({ sku: line.sku, color: line.color, size: line.size, requested: line.qty, available: 0, ok: false, note: "판매종료 확인" });
          continue;
        }
        const key = buildOptionKey(line.color, line.size);
        const opt = rec.optionStock.find((e) => e.optionKey === key);
        if (opt) {
          if (opt.available === false) {
            // available=false는 검증된 품절 판정만 담는다(모호성은 ingest에서 null로 강제)
            anyBlocked = true;
            checked.push({ sku: line.sku, color: line.color, size: line.size, requested: line.qty, available: opt.quantity ?? 0, ok: false, note: "옵션 품절 확인" });
            continue;
          }
          if (typeof opt.quantity === "number") {
            const ok = opt.quantity >= line.qty;
            if (!ok) anyBlocked = true;
            checked.push({ sku: line.sku, color: line.color, size: line.size, requested: line.qty, available: opt.quantity, ok });
            continue;
          }
        }
        if (typeof rec.stockQuantity === "number") {
          // 옵션 행 미확인 시 상품 단위 수량으로 판정 (옵션 구조가 검증되면 옵션이 우선된다)
          const ok = rec.stockQuantity >= line.qty;
          if (!ok) anyBlocked = true;
          checked.push({ sku: line.sku, color: line.color, size: line.size, requested: line.qty, available: rec.stockQuantity, ok, note: "상품 단위 수량 판정" });
          continue;
        }
        allDefinitive = false;
        checked.push({
          sku: line.sku,
          color: line.color,
          size: line.size,
          requested: line.qty,
          available: null,
          ok: null,
          note: "수량 미확인 (TYPE B) — 품절 아님, 미확정",
        });
      }
      const definitive = allDefinitive;
      return {
        ok: definitive ? !anyBlocked : null,
        definitive,
        adapter: this.name,
        checkedAt: now.toISOString(),
        lines: checked,
      };
    },
  };
}
