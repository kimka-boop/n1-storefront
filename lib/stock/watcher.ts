/**
 * N°1 Deterministic Stock Watcher — 결정적 오케스트레이션 (미션 §5·§6)
 *
 * 원칙:
 * - LLM(HERMES reasoning)은 매 사이클 공급처 페이지를 읽지 않는다. 결정적 파서가 읽고,
 *   파서 실패·레이아웃 변경·옵션 모호성에서만 에스컬레이션이 올라간다.
 * - cadence: 공급처별 합리적 주기 + 지터 + 일일 상한 + 실패 백오프. 무한 polling 금지.
 * - anti-bot bypass 금지: 문서화된 공개 OpenAPI만, 표준 UA, 순차 호출, 호출 간 지연.
 *
 * I/O는 전부 주입된다(fetchQueue/saveQueue/executeProbe 등) — 테스트는 오프라인으로 돈다.
 */
import { StockEscalation, StockRecord } from "./types";
import { mergeRecords } from "./normalize";
import {
  SUPPLIER_NAME,
  buildApiUrl,
  factToStockRecord,
  parseGetItemView,
} from "./sources";
import { ProbeResultEnvelope, buildProbeRequest, buildStagingWriteRequest } from "./bridge";

/** 공급처별 cadence 정책 (초) — 현재 전 44건이 도매꾹 단일 공급처 */
export interface SupplierCadence {
  supplierName: string;
  /** 상품 상세(item_view) 재검증 주기 */
  itemViewIntervalSec: number;
  /** 주기에 더하는 결정적 지터 상한 (productId 해시 기반 — 실행마다 달라지지 않음) */
  jitterSec: number;
  /** 상품당 하루 프로브 상한 (무한 polling 방지) */
  dailyCapPerProduct: number;
  /** 실패 시 백오프 배수 (지수, 상한 48h) */
  backoffMultiplier: number;
  /** 호출 간 최소 지연 (polite pacing) */
  minGapSec: number;
}

export const DOMEGGOOK_CADENCE: SupplierCadence = {
  supplierName: SUPPLIER_NAME,
  itemViewIntervalSec: 6 * 3600, // 6시간
  jitterSec: 15 * 60, // 15분
  dailyCapPerProduct: 4,
  backoffMultiplier: 2,
  minGapSec: 1.2,
};

const BACKOFF_CAP_SEC = 48 * 3600;

function hashJitter(seed: string, cap: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % Math.max(cap, 1));
}

/** 프로브 실행 주입점 — direct 모드는 HTTPS fetch, bridge 모드는 큐 적재, 테스트는 스텁 */
export type ExecuteProbe = (url: string, productId: string) => Promise<{ ok: boolean; body?: unknown; error?: string }>;

export interface WatcherDeps {
  catalog: Array<{ productId: string; supplierName: string; supplierProductId: string; supplierUrl: string }>;
  now: () => Date;
  /** 현재 원장 (productId → 마지막 레코드) */
  loadLedger: () => Promise<Record<string, StockRecord>>;
  saveLedger: (next: Record<string, StockRecord>) => Promise<void>;
  enqueueProbeRequest?: (req: ReturnType<typeof buildProbeRequest>) => Promise<void>;
  enqueueEscalations?: (list: StockEscalation[]) => Promise<void>;
  /** bridge 모드(null)에서는 프로브를 실행하지 않고 큐 적재만 */
  executeProbe?: ExecuteProbe | null;
  /** 실행 환경에 API 키가 주입되어 있는지 — 값 자체는 넘기지 않는다 */
  hasApiKey: () => boolean;
  cadence?: SupplierCadence;
  /** 큐에 쌓인 HERMES 결과 소비 (bridge 모드 ingest) */
  loadInboundResults?: () => Promise<ProbeResultEnvelope[]>;
  enqueueStagingWrite?: (req: ReturnType<typeof buildStagingWriteRequest>) => Promise<void>;
  log?: (line: string) => void;
}

/** 이번 사이클에 프로브할 상품 결정 — 결정적 (cadence + 지터 + 상한 + 백오프) */
export function buildProbePlan(
  catalog: WatcherDeps["catalog"],
  ledger: Record<string, StockRecord>,
  cadence: SupplierCadence,
  now: Date,
  failureCounts: Record<string, number> = {},
  probeCountsToday: Record<string, number> = {},
): { due: WatcherDeps["catalog"]; deferred: Array<{ productId: string; reason: string }> } {
  const due: WatcherDeps["catalog"] = [];
  const deferred: Array<{ productId: string; reason: string }> = [];
  for (const item of catalog) {
    const last = ledger[item.productId];
    if ((probeCountsToday[item.productId] ?? 0) >= cadence.dailyCapPerProduct) {
      deferred.push({ productId: item.productId, reason: "DAILY_CAP" });
      continue;
    }
    const failures = failureCounts[item.productId] ?? 0;
    let interval = cadence.itemViewIntervalSec;
    if (failures > 0) {
      interval = Math.min(interval * Math.pow(cadence.backoffMultiplier, failures), BACKOFF_CAP_SEC);
    }
    const elapsedSec = last?.stockVerifiedAt
      ? (now.getTime() - Date.parse(last.stockVerifiedAt)) / 1000
      : Number.POSITIVE_INFINITY;
    if (elapsedSec < interval + hashJitter(item.productId, cadence.jitterSec)) {
      deferred.push({ productId: item.productId, reason: "CADENCE_WAIT" });
      continue;
    }
    due.push(item);
  }
  return { due, deferred };
}

/** 프로브 간 polite pacing 지연 계산 (호출 사이 minGapSec) */
export function probeDelayMs(index: number, cadence: SupplierCadence): number {
  return index === 0 ? 0 : cadence.minGapSec * 1000;
}

/** 프로브 결과(raw JSON) → 레코드 반영 + 에스컬레이션. 파서 실패 시 기존 검증값 보존(변형 없음) */
export async function ingestRawItemView(
  item: WatcherDeps["catalog"][number],
  raw: unknown,
  nowIso: string,
  ledger: Record<string, StockRecord>,
): Promise<{ record: StockRecord | null; escalations: StockEscalation[] }> {
  const fact = parseGetItemView(raw, nowIso);
  if (!fact) {
    return {
      record: null,
      escalations: [
        {
          reason: "PARSER_FAILURE",
          productId: item.productId,
          supplierProductId: item.supplierProductId,
          detail: "getItemView 응답 파싱 불가",
          raisedAt: nowIso,
        },
      ],
    };
  }
  if (fact.parserFailure) {
    return {
      record: null,
      escalations: [
        {
          reason: fact.parserFailure.includes("부재") ? "LAYOUT_CHANGE" : "PARSER_FAILURE",
          productId: item.productId,
          supplierProductId: item.supplierProductId,
          detail: fact.parserFailure,
          raisedAt: nowIso,
        },
      ],
    };
  }
  const { record, escalations } = factToStockRecord(fact, {
    productId: item.productId,
    supplierName: item.supplierName,
    supplierUrl: item.supplierUrl,
  });
  if (!record) return { record: null, escalations };
  return { record: mergeRecords(ledger[item.productId] ?? null, record), escalations };
}

/**
 * 1 사이클 실행.
 * - direct 모드(hasApiKey && executeProbe): 프로브 실행 → ingest → 원장 갱신.
 * - bridge 모드(그 외): due 상품만 outbound 큐에 적재하고 끝난다 (HERMES 실행 대기).
 * 결과는 원장 저장 + (주입 시) staging write 요청 적재.
 */
export async function runWatcherCycle(deps: WatcherDeps): Promise<{
  mode: "direct" | "bridge";
  due: string[];
  deferred: Array<{ productId: string; reason: string }>;
  updated: string[];
  escalated: StockEscalation[];
}> {
  const cadence = deps.cadence ?? DOMEGGOOK_CADENCE;
  const now = deps.now();
  const nowIso = now.toISOString();
  const ledger = await deps.loadLedger();
  const { due, deferred } = buildProbePlan(deps.catalog, ledger, cadence, now);
  const direct = Boolean(deps.hasApiKey() && deps.executeProbe);
  const escalated: StockEscalation[] = [];
  const updated: string[] = [];

  if (!direct) {
    for (const item of due) {
      await deps.enqueueProbeRequest?.(buildProbeRequest(item, nowIso));
      deps.log?.(`[bridge] probe 요청 적재 ${item.productId}`);
    }
    return { mode: "bridge", due: due.map((d) => d.productId), deferred, updated, escalated };
  }

  const execute = deps.executeProbe!;
  let first = true;
  for (const item of due) {
    if (!first) await new Promise((r) => setTimeout(r, probeDelayMs(1, cadence)));
    first = false;
    const aid = process.env.DOMEGGOOK_API_KEY ?? "";
    const url = buildApiUrl("getItemView", "4.6", { no: item.supplierProductId }, aid);
    let res: { ok: boolean; body?: unknown; error?: string };
    try {
      res = await execute(url, item.productId);
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!res.ok) {
      escalated.push({
        reason: "SOURCE_UNREACHABLE",
        productId: item.productId,
        supplierProductId: item.supplierProductId,
        detail: `프로브 실패: ${res.error ?? "unknown"}`,
        raisedAt: nowIso,
      });
      continue;
    }
    const { record, escalations } = await ingestRawItemView(item, res.body, nowIso, ledger);
    escalated.push(...escalations);
    if (record && record.stockVerifiedAt) {
      ledger[item.productId] = { ...record, probeId: record.probeId ?? nowIso };
      updated.push(item.productId);
    }
  }

  await deps.saveLedger(ledger);
  const records = updated.map((id) => ledger[id]).filter(Boolean);
  if (records.length && deps.enqueueStagingWrite) {
    await deps.enqueueStagingWrite(buildStagingWriteRequest(records, `SW-${nowIso.replace(/[:.\-]/g, "").slice(0, 14)}`, nowIso));
  }
  if (escalated.length && deps.enqueueEscalations) await deps.enqueueEscalations(escalated);
  return { mode: "direct", due: due.map((d) => d.productId), deferred, updated, escalated };
}

/**
 * bridge 결과 소비 — HERMES가 inbound에 적재한 raw 응답을 원장에 반영한다.
 * (direct 모드와 동일한 파서·에스컬레이션 경로를 통과한다 — 우회 없음)
 */
export async function ingestBridgeResults(deps: WatcherDeps): Promise<{ updated: string[]; escalated: StockEscalation[] }> {
  const results = (await deps.loadInboundResults?.()) ?? [];
  const ledger = await deps.loadLedger();
  const nowIso = deps.now().toISOString();
  const updated: string[] = [];
  const escalated: StockEscalation[] = [];
  for (const r of results) {
    const item = deps.catalog.find((c) => c.productId === r.productId);
    if (!item) continue;
    const fetchedAt = r.fetchedAt || nowIso;
    const { record, escalations } = await ingestRawItemView(item, r.raw, fetchedAt, ledger);
    escalated.push(...escalations);
    if (record) {
      ledger[item.productId] = record;
      updated.push(item.productId);
    }
  }
  await deps.saveLedger(ledger);
  if (escalated.length && deps.enqueueEscalations) await deps.enqueueEscalations(escalated);
  return { updated, escalated };
}
