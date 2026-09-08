/**
 * N°1 Stock HERMES 브릿지 — credential 비보유 계약 (미션 §4)
 *
 * ZCode는 공급처 API 키·시트 credential을 받지 않는다. 다음 두 경로만 존재:
 *  1) direct 모드  : 서버 런타임에 HERMES가 env(DOMEGGOOK_API_KEY)를 주입한 경우
 *     워처가 자체 실행. 코드는 env "변수명"만 안다 — 값을 어떤 산출물에도 기록하지 않는다.
 *  2) bridge 모드  : 키가 없으면 프로브 요청 JSON을 outbound 큐에 적고 HERMES 실행을 대기.
 *     HERMES는 source read → normalized result → Stock_Staging 시트 write → readback을 수행하고
 *     inbound 큐에 결과를 적는다. 워처는 readback 검증(validateReadback)으로 마무리.
 *
 * 큐 레이아웃 (mission-20260909/N1_STOCK_BRIDGE/):
 *   outbound/  probe-request-*.json   (ZCode → HERMES)
 *   inbound/   probe-result-*.json    (HERMES → ZCode)
 *   inbound/   staging-readback-*.json
 *   escalations/*.json                (워처 → HERMES 추론 대기행)
 */
import { StockEscalation, StockRecord } from "./types";
import { STOCK_STAGING_HEADERS, recordToStagingRow, validateReadback } from "./normalize";

export const STOCK_STAGING_TAB = "Stock_Staging";

export interface ProbeRequest {
  requestId: string;
  productId: string;
  supplierName: string;
  supplierProductId: string;
  supplierUrl: string;
  /** 수행할 프로브: item_view 필수, list_presence·supply_chk는 보조 */
  probes: Array<"item_view" | "list_presence" | "supply_chk">;
  requestedAt: string;
  requestedBy: "n1-stock-watcher";
}

export interface ProbeResultEnvelope {
  requestId: string;
  productId: string;
  supplierProductId: string;
  source: string;
  fetchedAt: string;
  /** HERMES가 실행한 실제 호출 방식 (domeggook.api https) */
  execution: string;
  /** 파서에 그대로 넘길 공급처 응답 원문 (JSON) */
  raw: unknown;
  /** HERMES 판정 메모 (있다면) */
  hermesNote?: string;
}

export interface StagingWriteRequest {
  requestType: "STOCK_STAGING_WRITE";
  requestId: string;
  tab: string;
  headers: readonly string[];
  rows: Record<string, string>[];
  expectedRowCount: number;
  requestedAt: string;
  requestedBy: "n1-stock-watcher";
}

export interface StagingReadbackReport {
  requestType: "STOCK_STAGING_READBACK";
  requestId: string;
  tab: string;
  rows: Record<string, string>[];
  readAt: string;
}

/** 프로브 요청 생성 — requestId는 결정적 (productId + 타임스탬프) */
export function buildProbeRequest(
  catalog: { productId: string; supplierName: string; supplierProductId: string; supplierUrl: string },
  now: string,
  probes: ProbeRequest["probes"] = ["item_view"],
): ProbeRequest {
  return {
    requestId: `PB-${catalog.productId}-${now.replace(/[:.\-]/g, "").slice(0, 14)}`,
    productId: catalog.productId,
    supplierName: catalog.supplierName,
    supplierProductId: catalog.supplierProductId,
    supplierUrl: catalog.supplierUrl,
    probes,
    requestedAt: now,
    requestedBy: "n1-stock-watcher",
  };
}

/** Stock_Staging 시트 write 요청 생성 (readback 대비 기대 rows 포함) */
export function buildStagingWriteRequest(records: StockRecord[], requestId: string, now: string): StagingWriteRequest {
  const rows = records.map(recordToStagingRow);
  return {
    requestType: "STOCK_STAGING_WRITE",
    requestId,
    tab: STOCK_STAGING_TAB,
    headers: STOCK_STAGING_HEADERS,
    rows,
    expectedRowCount: rows.length,
    requestedAt: now,
    requestedBy: "n1-stock-watcher",
  };
}

/** HERMES readback 검증 — 불일치는 조용히 통과하지 않는다 (미션 §4 readback) */
export function validateStagingReadback(
  write: StagingWriteRequest,
  report: StagingReadbackReport,
): { ok: boolean; mismatches: string[] } {
  if (report.requestType !== "STOCK_STAGING_READBACK") {
    return { ok: false, mismatches: ["readback report type 불일치"] };
  }
  if (report.requestId !== write.requestId) {
    return { ok: false, mismatches: [`requestId 불일치: ${write.requestId} vs ${report.requestId}`] };
  }
  if (report.tab !== write.tab) {
    return { ok: false, mismatches: [`탭 불일치: ${write.tab} vs ${report.tab}`] };
  }
  const check = validateReadback(write.rows, report.rows);
  return check;
}

/** 에스컬레이션 적재 항목 — HERMES 추론 트리거 (미션 §5: parser failure/layout change/option ambiguity) */
export function buildEscalationEntry(e: StockEscalation): Record<string, string> {
  return {
    reason: e.reason,
    productId: e.productId,
    supplierProductId: e.supplierProductId,
    detail: e.detail,
    raisedAt: e.raisedAt,
    probeId: e.probeId ?? "",
  };
}
