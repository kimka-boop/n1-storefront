/**
 * N°1 Stock 정규화 계층 — 순수 함수 (네트워크·시트·파일 I/O 없음)
 *
 * 계약:
 * - 옵션 키 규약 `${color}_${size}` — lib/experience.purchaseState·/api/orders와 동일
 * - 시트 `옵션별재고` 직렬화 `k:v|k:v` — catalog.ts parseStock·/api/orders 차감과 호환
 * - freshness는 stock_verified_at 기준 상수 판정 (미션 §7)
 */
import { Freshness, OptionStockEntry, StockRecord, StockStatus, StockType } from "./types";

/** 검증 후 신선 판정 창 (시간). HERMES cadence(6h)보다 넉넉한 24h */
export const FRESH_WINDOW_HOURS = 24;

/** 옵션 라인 키 — /api/orders·experience.ts와 동일 규약 (색상 없으면 사이즈만) */
export function buildOptionKey(color: string, size: string): string {
  const c = (color || "").trim();
  const s = (size || "").trim();
  return c && s ? `${c}_${s}` : s || c || "";
}

/** 시트 `옵션별재고` 파싱 — catalog.ts parseStock과 동일 포맷 (정수만 수용) */
export function parseOptionStockString(raw: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of String(raw || "").split("|")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k || v === "" || !/^-?\d+$/.test(v)) continue;
    out[k] = Number(v);
  }
  return out;
}

/** 시트 `옵션별재고` 직렬화 — 확인된 정수 수량만 기록 (null·음수·비정수 배제) */
export function serializeOptionStock(entries: OptionStockEntry[]): string {
  return entries
    .filter((e) => typeof e.quantity === "number" && Number.isInteger(e.quantity) && e.quantity >= 0)
    .map((e) => `${e.optionKey}:${e.quantity}`)
    .join("|");
}

/** 시트 행 → 원본 옵션 정체성 복원 (`옵션원본` 컬럼 JSON) */
export function parseOptionStockJson(raw: string | null | undefined): OptionStockEntry[] | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return null;
    const entries: OptionStockEntry[] = [];
    for (const e of parsed) {
      if (typeof e !== "object" || e === null || typeof (e as any).optionKey !== "string") return null;
      const q = (e as any).quantity;
      const av = (e as any).available;
      entries.push({
        optionKey: String((e as any).optionKey),
        color: String((e as any).color ?? ""),
        size: String((e as any).size ?? ""),
        quantity: typeof q === "number" && Number.isFinite(q) ? q : null,
        available: typeof av === "boolean" ? av : null,
        rawLabel: String((e as any).rawLabel ?? ""),
      });
    }
    return entries;
  } catch {
    return null;
  }
}

/** 공급처 원문 판매상태 → 시트 어휘 정규화 (창작 없음 — 알려진 값만 매핑) */
export function normalizeStatus(raw: string | null | undefined): StockStatus {
  const v = String(raw || "").trim();
  if (!v) return "UNKNOWN";
  if (v === "판매중") return "판매중";
  if (v === "품절") return "품절";
  if (v === "판매종료" || v === "기간종료") return "판매종료";
  return "UNKNOWN";
}

/** 확인된 사실(상태/수량)에서 최종 판매 상태 도출.
 *  qty.inventory=0 + 판매중 → 출고 불가이므로 '품절' 파생 (notes로 근거 남김) */
export function deriveStatus(status: StockStatus, quantity: number | null): { status: StockStatus; note?: string } {
  if (typeof quantity === "number" && quantity === 0 && status !== "판매종료") {
    return { status: "품절", note: "재고수량 0 확인 → 품절 파생" };
  }
  return { status };
}

/** stock_verified_at 기반 신선도 (미션 §7) */
export function freshnessOf(verifiedAt: string | null | undefined, now: Date = new Date()): Freshness {
  if (!verifiedAt) return "UNKNOWN";
  const t = Date.parse(verifiedAt);
  if (!Number.isFinite(t)) return "UNKNOWN";
  return now.getTime() - t <= FRESH_WINDOW_HOURS * 3600_000 ? "FRESH" : "STALE";
}

/**
 * 소스 유형 분류 (미션 §2) — 확정된 사실 조합으로만 판정.
 * - 숫자(상품 또는 검증된 옵션 행) 있으면 A
 * - 상태/존재/품절 플래그만 있으면 B
 * - selectOpt 존재하나 구조 미검증이면 옵션 한정 D (상품 레벨 사실은 유지)
 */
export function classifyType(facts: {
  hasNumericQuantity: boolean;
  hasVerifiedOptionQuantity: boolean;
  hasStatusOrPresence: boolean;
  hasOptionAmbiguity: boolean;
}): StockType {
  if (facts.hasNumericQuantity || facts.hasVerifiedOptionQuantity) return "A";
  if (facts.hasStatusOrPresence) return "B";
  if (facts.hasOptionAmbiguity) return "D";
  return "UNKNOWN";
}

/** 레코드 병합 — 최신 stock_verified_at 승 (동률 시 기존 유지, deterministic) */
export function mergeRecords(prev: StockRecord | null, next: StockRecord): StockRecord {
  if (!prev) return next;
  const pt = prev.stockVerifiedAt ? Date.parse(prev.stockVerifiedAt) : -1;
  const nt = next.stockVerifiedAt ? Date.parse(next.stockVerifiedAt) : -1;
  return nt > pt ? next : prev;
}

/** 시트 스테이징 행 스키마 (Stock_Staging 탭 — HERMES write/readback 대상) */
export const STOCK_STAGING_HEADERS = [
  "상품ID",
  "공급사명",
  "공급사코드",
  "공급사URL",
  "재고상태",
  "재고수량",
  "재고유형",
  "재고검증일시",
  "재고소스",
  "재고신뢰도",
  "옵션별재고",
  "옵션원본",
  "비고",
] as const;

export function recordToStagingRow(r: StockRecord): Record<string, string> {
  return {
    상품ID: r.productId,
    공급사명: r.supplierName,
    공급사코드: r.supplierProductId,
    공급사URL: r.supplierUrl,
    재고상태: r.stockStatus,
    재고수량: r.stockQuantity === null ? "" : String(r.stockQuantity),
    재고유형: r.stockType,
    재고검증일시: r.stockVerifiedAt ?? "",
    재고소스: r.stockSource,
    재고신뢰도: r.stockConfidence,
    옵션별재고: serializeOptionStock(r.optionStock),
    옵션원본: JSON.stringify(r.optionStock),
    비고: (r.notes || []).join(" / "),
  };
}

export function stagingRowToRecord(row: Record<string, string>): StockRecord | null {
  const id = String(row["상품ID"] || "").trim();
  if (!id) return null;
  const qRaw = String(row["재고수량"] || "").trim();
  const quantity = qRaw !== "" && /^-?\d+$/.test(qRaw) ? Number(qRaw) : null;
  const verified = String(row["재고검증일시"] || "").trim() || null;
  const fromJson = parseOptionStockJson(row["옵션원본"]);
  const numericMap = parseOptionStockString(row["옵션별재고"]);
  const optionStock: OptionStockEntry[] =
    fromJson ??
    Object.entries(numericMap).map(([k, v]) => ({
      optionKey: k,
      color: k.includes("_") ? k.slice(0, k.lastIndexOf("_")) : "",
      size: k.includes("_") ? k.slice(k.lastIndexOf("_") + 1) : k,
      quantity: v,
      available: v > 0,
      rawLabel: "",
    }));
  return {
    productId: id,
    supplierName: String(row["공급사명"] || ""),
    supplierProductId: String(row["공급사코드"] || ""),
    supplierUrl: String(row["공급사URL"] || ""),
    stockStatus: normalizeStatus(row["재고상태"]),
    stockQuantity: quantity,
    stockType: (String(row["재고유형"] || "UNKNOWN") as StockType) || "UNKNOWN",
    stockVerifiedAt: verified,
    stockSource: String(row["재고소스"] || "") || "NOT_STAGED",
    stockConfidence: (String(row["재고신뢰도"] || "UNKNOWN") as StockRecord["stockConfidence"]) || "UNKNOWN",
    optionStock,
    notes: String(row["비고"] || "") ? String(row["비고"]).split(" / ").filter(Boolean) : [],
  };
}

/** HERMES readback 검증 — write 요청 rows와 실제 시트 readback의 결정적 비교 */
export function validateReadback(
  expectedRows: Record<string, string>[],
  actualRows: Record<string, string>[],
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const expectedById = new Map(expectedRows.map((r) => [String(r["상품ID"]), r]));
  const actualById = new Map(actualRows.map((r) => [String(r["상품ID"]), r]));
  for (const [id, exp] of Array.from(expectedById.entries())) {
    const act = actualById.get(id);
    if (!act) {
      mismatches.push(`${id}: readback 행 누락`);
      continue;
    }
    for (const h of STOCK_STAGING_HEADERS) {
      if (String(exp[h] ?? "") !== String(act[h] ?? "")) {
        mismatches.push(`${id}.${h}: expected="${exp[h]}" actual="${act[h]}"`);
      }
    }
  }
  for (const id of Array.from(actualById.keys())) {
    if (!expectedById.has(id)) mismatches.push(`${id}: 요청에 없는 readback 행`);
  }
  return { ok: mismatches.length === 0, mismatches };
}
