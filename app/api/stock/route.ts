/**
 * N°1 Stock Truth Read API — stable contract n1.stock.v1 (SESSION B, 미션 §8)
 *
 * GET /api/stock                      → 전 카탈로그 재고 뷰
 * GET /api/stock?sku=PRD-N1-01        → 1건
 * GET /api/stock?skus=PRD-N1-01,PRD-N1-02 → 배치 (Checkout recheck용)
 *
 * 읽기 우선순위 (deterministic):
 *   1. Sheets `Stock_Staging` 탭 (source of truth — HERMES staging write/readback 완료분)
 *   2. 로컬 원장 미러 mission-20260909/N1_STOCK_BRIDGE/ledger.json (staged:false로 표시)
 *   3. 없으면 UNKNOWN — 절대 숫자를 만들지 않는다 (미션 §2 창작 금지)
 *
 * 이 라우트는 읽기 전용이다. PDP/Checkout 수정은 Session H 소관이며 이 파일이 건드리지 않는다.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDoc } from "@/lib/sheets";
import { StockRecord, StockView } from "@/lib/stock/types";
import { freshnessOf, stagingRowToRecord } from "@/lib/stock/normalize";
import { STOCK_STAGING_TAB } from "@/lib/stock/bridge";
import { loadLedgerFile } from "@/lib/stock/ledger";

export const dynamic = "force-dynamic";

// Next.js 라우트 모듈은 핸들러·route config 외 export 금지 — 계약 버전은 응답 본문으로만 공개.
const CONTRACT_VERSION = "n1.stock.v1";

const UNKNOWN_VIEW_BASE = {
  stockStatus: "UNKNOWN" as const,
  stockQuantity: null,
  stockType: "UNKNOWN" as const,
  stockVerifiedAt: null,
  stockSource: "NOT_STAGED",
  stockConfidence: "UNKNOWN" as const,
  optionStock: [],
};

function unknownView(productId: string, staged: boolean): StockView {
  return {
    productId,
    supplierName: "",
    supplierProductId: "",
    supplierUrl: "",
    ...UNKNOWN_VIEW_BASE,
    stockSource: staged ? "STAGED_ROW_INVALID" : "NOT_STAGED",
    fresh: false,
    freshness: "UNKNOWN",
    staged,
  };
}

function toView(rec: StockRecord, staged: boolean, now: Date): StockView {
  const freshness = freshnessOf(rec.stockVerifiedAt, now);
  return {
    ...rec,
    freshness,
    fresh: freshness === "FRESH",
    staged,
  };
}

/** 시트 Stock_Staging 탭 → productId별 StockRecord. 탭 부재/오류 시 null (폴백 트리거) */
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
    return null; // 시트 도달 불가 → 원장 미러 폴백 (정직 표시)
  }
}

async function ledgerRecords(): Promise<Record<string, StockRecord>> {
  try {
    const file = path.join(process.cwd(), "mission-20260909", "N1_STOCK_BRIDGE", "ledger.json");
    if (!fs.existsSync(file)) return {};
    return await loadLedgerFile(file);
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const skuParam = (url.searchParams.get("sku") || "").trim();
  const skusParam = (url.searchParams.get("skus") || "").trim();
  const requested = skusParam
    ? skusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : skuParam
      ? [skuParam]
      : null;
  if (requested !== null && requested.length === 0) {
    return NextResponse.json({ ok: false, contractVersion: CONTRACT_VERSION, error: "sku/skus 파라미터가 비어 있다" }, { status: 400 });
  }

  const now = new Date();
  const staging = await loadStagingRecords();
  const ledger = await ledgerRecords();

  // 대상 집합: 요청 skus ∪ (요청 없으면 staging ∪ ledger 전체)
  const knownIds = new Set<string>([...Object.keys(staging ?? {}), ...Object.keys(ledger)]);
  const targets = requested ?? Array.from(knownIds).sort();

  const stocks: Record<string, StockView> = {};
  for (const id of targets) {
    const fromStaging = staging?.[id];
    if (fromStaging) {
      stocks[id] = toView(fromStaging, true, now);
      continue;
    }
    const fromLedger = ledger[id];
    stocks[id] = fromLedger ? toView(fromLedger, false, now) : unknownView(id, false);
  }

  // missing: 카탈로그(Products)에 존재하지 않는 요청 sku — staging/ledger 어디에도 없고
  // 카탈로그 조회가 불가능하면 판정하지 않는다 (추측 금지).
  const missing: string[] = [];
  if (requested) {
    try {
      const doc = await getDoc();
      const products = doc.sheetsByIndex[0];
      const rows = await products.getRows();
      const catalogIds = new Set(rows.map((r) => String(r.get("상품ID") || "").trim()).filter(Boolean));
      for (const id of requested) if (!catalogIds.has(id)) missing.push(id);
    } catch {
      // 카탈로그 미도달 — missing 미판정 (빈 배열, 판단 유보)
    }
  }

  return NextResponse.json({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    checkedAt: now.toISOString(),
    stagedReadable: staging !== null,
    stocks,
    missing,
  });
}
