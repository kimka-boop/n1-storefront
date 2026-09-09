/**
 * N°1 Checkout Stock 배선 — 서버 전용 (SESSION H, TASK 13)
 *
 * Session C가 남긴 finalStockCheck 경계(lib/supplierStock.ts)에 Session B의 검증 원장
 * (lib/stock/adapter.ts)을 주입한다. 읽기 우선순위는 /api/stock과 동일하게
 * Stock_Staging(1순위) → 로컬 원장 미러(2순위) → 빈 값(UNKNOWN)이며, sku 단위로 병합한다.
 *
 * - 결제 개시 직전마다 새 시계(new Date())로 어댑터를 판다 — 장기 구동 프로세스에서
 *   freshness가 등록 시각에 얼는 것을 막는다 (stockVerifiedAt은 검증 시각 그대로).
 * - 어댑터 등록은 이 모듈을 거치는 서버 프로세스에만 적용된다. 테스트/다른 경로는
 *   기본 noop 어댑터(definitive:false — 미확정)를 유지한다 (commerce C13 계약).
 * - 차감은 Stock_Staging 기준으로만 한다. 기존 Products AB열 차감은 제거 대상이다 —
 *   신규 시트의 AB열은 unisex_score라 옵션 문자열을 쓰면 데이터를 오염시킨다 (B 리포트 지뢰 1).
 */
import { getDoc } from "@/lib/sheets";
import { createStockBackendAdapter, StockLedgerLoader } from "@/lib/stock/adapter";
import { registerStockAdapter, finalStockCheck, StockCheckLine, StockCheckResult } from "@/lib/supplierStock";
import { STOCK_STAGING_TAB } from "@/lib/stock/bridge";
import { loadLedgerFile } from "@/lib/stock/ledger";
import { stagingRowToRecord, recordToStagingRow, buildOptionKey, parseOptionStockString } from "@/lib/stock/normalize";
import { StockRecord } from "@/lib/stock/types";
import { GateLine, applyOrderDecrement } from "@/lib/stockGate";

/** Stock_Staging 탭 → productId별 레코드. 탭 부재/도달 실패는 null (정직 폴백 트리거) */
async function loadStagingRecords(): Promise<Record<string, StockRecord> | null> {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle[STOCK_STAGING_TAB];
    if (!sheet) return null;
    const rows = await sheet.getRows();
    const out: Record<string, StockRecord> = {};
    for (const row of rows) {
      const rec = stagingRowToRecord({
        상품ID: String(row.get("상품ID") ?? ""),
        공급사명: String(row.get("공급사명") ?? ""),
        공급사코드: String(row.get("공급사코드") ?? ""),
        공급사URL: String(row.get("공급사URL") ?? ""),
        재고상태: String(row.get("재고상태") ?? ""),
        재고수량: String(row.get("재고수량") ?? ""),
        재고유형: String(row.get("재고유형") ?? ""),
        재고검증일시: String(row.get("재고검증일시") ?? ""),
        재고소스: String(row.get("재고소스") ?? ""),
        재고신뢰도: String(row.get("재고신뢰도") ?? ""),
        옵션별재고: String(row.get("옵션별재고") ?? ""),
        옵션원본: String(row.get("옵션원본") ?? ""),
        비고: String(row.get("비고") ?? ""),
      });
      if (rec) out[rec.productId] = rec;
    }
    return out;
  } catch {
    return null; // 시트 도달 불가 → 원장 미러 폴백 (판정 보류 — 품절 창작 금지)
  }
}

let cachedLoader: StockLedgerLoader | null = null;

/** /api/stock과 동일 우선순위의 레코드 로더 — sku 단위 staging 승 병합 */
function getLoader(): StockLedgerLoader {
  if (!cachedLoader) {
    cachedLoader = async () => {
      const staging = await loadStagingRecords();
      let ledger: Record<string, StockRecord> = {};
      try {
        ledger = await loadLedgerFile();
      } catch {
        ledger = {}; // 원장 부재 = 빈 원장 (창작 없음)
      }
      return staging ? { ...ledger, ...staging } : ledger;
    };
  }
  return cachedLoader;
}

/**
 * 결제 개시 직전 최종 재고 확인 — C 경계(finalStockCheck) × B 어댑터의 단일 접속점.
 * 호출 시각 기준 freshness로 판정한다.
 */
export async function checkoutFinalStockCheck(lines: StockCheckLine[]): Promise<StockCheckResult> {
  registerStockAdapter(createStockBackendAdapter(getLoader(), new Date()));
  return finalStockCheck(lines);
}

export interface DecrementOutcome {
  /** staging 행을 찾아 차감에 반영한 sku */
  decremented: string[];
  /** staging에 없어 차감을 보류한 sku — 다음 공급처 재검증(cadence)이 값을 다시 맞춘다 */
  skipped: string[];
}

/**
 * 주문 확정 후 Stock_Staging 차감 — 검증 수량의 정직한 차감.
 * - 옵션행/상품 수량 중 **확인된 숫자만** 차감한다(applyOrderDecrement — 순수 계산).
 * - 재고검증일시는 불변: 차감은 새 검증이 아니며 근거는 비고 "주문 차감" 기록으로 남는다.
 * - staging 행이 없는 sku는 보류(skipped) — Products AB열(unisex_score)에는 절대 쓰지 않는다.
 * - 실패해도 주문을 되돌리지 않는다(경계 계약) — 오류는 로그로 남긴다.
 */
export async function decrementStagingStock(items: GateLine[], orderId: string): Promise<DecrementOutcome> {
  const outcome: DecrementOutcome = { decremented: [], skipped: [] };
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle[STOCK_STAGING_TAB];
    if (!sheet) {
      outcome.skipped = Array.from(new Set(items.map((i) => i.sku)));
      return outcome;
    }
    const rows = await sheet.getRows();
    const bySku = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const id = String(row.get("상품ID") ?? "").trim();
      if (id && !bySku.has(id)) bySku.set(id, row);
    }
    const perSku = new Map<string, GateLine[]>();
    for (const it of items) {
      const list = perSku.get(it.sku) ?? [];
      list.push(it);
      perSku.set(it.sku, list);
    }
    for (const [sku, lines] of Array.from(perSku.entries())) {
      const row = bySku.get(sku);
      if (!row) {
        outcome.skipped.push(sku);
        continue;
      }
      const rec = stagingRowToRecord({
        상품ID: sku,
        공급사명: String(row.get("공급사명") ?? ""),
        공급사코드: String(row.get("공급사코드") ?? ""),
        공급사URL: String(row.get("공급사URL") ?? ""),
        재고상태: String(row.get("재고상태") ?? ""),
        재고수량: String(row.get("재고수량") ?? ""),
        재고유형: String(row.get("재고유형") ?? ""),
        재고검증일시: String(row.get("재고검증일시") ?? ""),
        재고소스: String(row.get("재고소스") ?? ""),
        재고신뢰도: String(row.get("재고신뢰도") ?? ""),
        옵션별재고: String(row.get("옵션별재고") ?? ""),
        옵션원본: String(row.get("옵션원본") ?? ""),
        비고: String(row.get("비고") ?? ""),
      });
      if (!rec) {
        outcome.skipped.push(sku);
        continue;
      }
      const { record, changed } = applyOrderDecrement(rec, lines, orderId);
      if (!changed) {
        // 확인된 숫자가 없는 행 — 차감할 검증값이 없다 (미확인을 숫자로 만들지 않는다)
        outcome.skipped.push(sku);
        continue;
      }
      const vals = recordToStagingRow(record);
      row.set("재고수량", vals["재고수량"]);
      row.set("옵션별재고", vals["옵션별재고"]);
      row.set("옵션원본", vals["옵션원본"]);
      row.set("비고", vals["비고"]);
      await row.save();
      outcome.decremented.push(sku);
    }
    return outcome;
  } catch (e: unknown) {
    console.warn(
      `[stock-decrement] Stock_Staging 차감 실패(주문은 유효 — 재검증이 값을 다시 맞춘다): ${orderId}`,
      e instanceof Error ? e.message : String(e),
    );
    return outcome;
  }
}

/** C 원본 폴백용 — Products 행의 `옵션별재고`에서 정확히 일치하는 옵션 키 수량만 (추론 없음) */
export function sheetOptionQty(productsRow: { get: (h: string) => string | undefined }, line: GateLine): number | undefined {
  const map = parseOptionStockString(String(productsRow.get("옵션별재고") ?? ""));
  const key = buildOptionKey(line.color, line.size);
  const v = map[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
