#!/usr/bin/env node
/**
 * N1 SESSION B — Deterministic Stock Watcher 러너 (미션 §5·§6)
 * 실행 위치: mission-20260909/   env: ../.env.local (선택 — DOMEGGOOK_API_KEY는 HERMES가 주입)
 *
 *   node stock_watcher.cjs --cycle   # 1 사이클: 키 있으면 direct 프로브, 없으면 bridge 큐 적재
 *   node stock_watcher.cjs --ingest  # HERMES가 inbound에 적재한 프로브 결과를 원장에 반영
 *   node stock_watcher.cjs --stage   # 원장 → Stock_Staging 시트 write 요청 생성 (outbound)
 *   node stock_watcher.cjs --status  # 원장 요약 출력
 *
 * 원칙:
 * - 키가 이 환경에 없으면 공급처 호출을 시도조차 하지 않고 bridge 큐에 적재한다 (ZCode 무 credential 계약).
 * - 카탈로그는 mission-20260909/N1_STOCK_SOURCE_MAP.json (Products 44건 = 상품ID/공급사코드/공급사URL).
 * - 모든 파싱은 lib/stock의 결정적 파서를 통과한다 — 이 러너는 I/O 배선만 담당.
 */
process.loadEnvFile("../.env.local");
const fs = require("fs");
const path = require("path");
const ts = require("../node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(code, filename);
};

const sources = require("../lib/stock/sources.ts");
const bridge = require("../lib/stock/bridge.ts");
const ledgerLib = require("../lib/stock/ledger.ts");
const watcher = require("../lib/stock/watcher.ts");

const BRIDGE = path.resolve(__dirname, "N1_STOCK_BRIDGE");
const OUTBOUND = path.join(BRIDGE, "outbound");
const INBOUND = path.join(BRIDGE, "inbound");
const ESCALATIONS = path.join(BRIDGE, "escalations");
const LEDGER_FILE = path.join(BRIDGE, "ledger.json");

function loadSourceMapCatalog() {
  const file = path.resolve(__dirname, "N1_STOCK_SOURCE_MAP.json");
  const map = JSON.parse(fs.readFileSync(file, "utf-8"));
  return map.rows.map((r) => ({
    productId: r.productId,
    supplierName: r.supplierName,
    supplierProductId: r.supplierProductId,
    supplierUrl: r.supplierUrlNormalized || r.supplierUrl,
  }));
}

function loadInbound(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("probe-result-") && f.endsWith(".json"))
    .sort()
    .map((f) => {
      const full = path.join(dir, f);
      const env = JSON.parse(fs.readFileSync(full, "utf-8"));
      fs.renameSync(full, full + ".consumed"); // 재소비 방지
      return env;
    });
}

(async () => {
  const mode = process.argv.includes("--ingest")
    ? "ingest"
    : process.argv.includes("--stage")
      ? "stage"
      : process.argv.includes("--status")
        ? "status"
        : process.argv.includes("--cycle")
          ? "cycle"
          : "";
  if (!mode) {
    console.error("usage: node stock_watcher.cjs --cycle | --ingest | --stage | --status");
    process.exit(1);
  }
  fs.mkdirSync(OUTBOUND, { recursive: true });
  fs.mkdirSync(INBOUND, { recursive: true });
  fs.mkdirSync(ESCALATIONS, { recursive: true });

  const catalog = loadSourceMapCatalog();
  const deps = {
    catalog,
    now: () => new Date(),
    loadLedger: async () => ledgerLib.loadLedgerFile(LEDGER_FILE),
    saveLedger: async (next) => ledgerLib.saveLedgerFile(next, LEDGER_FILE),
    enqueueProbeRequest: async (req) => {
      const file = path.join(OUTBOUND, `${req.requestId}.json`);
      fs.writeFileSync(file, JSON.stringify(req, null, 1), "utf-8");
      console.log(`[bridge] outbound: ${path.basename(file)} (probes: ${req.probes.join(",")})`);
    },
    enqueueEscalations: async (list) => {
      for (const e of list) {
        const entry = bridge.buildEscalationEntry(e);
        const file = path.join(ESCALATIONS, `${e.reason}-${e.productId}-${e.raisedAt.replace(/[:.]/g, "")}.json`);
        fs.writeFileSync(file, JSON.stringify(entry, null, 1), "utf-8");
        ledgerLib.appendAudit([`${e.raisedAt} ESCALATION ${e.reason} ${e.productId} ${e.detail}`]);
      }
      console.log(`[bridge] escalations: ${list.length}건 → ${ESCALATIONS}`);
    },
    enqueueStagingWrite: async (req) => {
      const file = path.join(OUTBOUND, `${req.requestId}.json`);
      fs.writeFileSync(file, JSON.stringify(req, null, 1), "utf-8");
      console.log(`[bridge] staging write 요청: ${path.basename(file)} rows=${req.rows.length} (HERMES 시트 write+readback 대기)`);
    },
    loadInboundResults: async () => loadInbound(INBOUND),
    // 키는 env 변수명으로만 존재 — 값은 이 파일 어디에도 기록되지 않는다.
    hasApiKey: () => Boolean(process.env.DOMEGGOOK_API_KEY),
    executeProbe: process.env.DOMEGGOOK_API_KEY
      ? async (url) => {
          const res = await fetch(url, { headers: { "User-Agent": sources.PROBE_UA }, redirect: "manual" });
          if (res.status >= 300 && res.status < 400) {
            return { ok: false, error: `리다이렉트(${res.status}) — 허용 호스트 외 미추종` };
          }
          if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
          return { ok: true, body: await res.json() };
        }
      : null,
    log: (l) => console.log(l),
  };

  if (mode === "cycle") {
    const result = await watcher.runWatcherCycle(deps);
    console.log(JSON.stringify({ ...result, escalated: result.escalated.length }, null, 1));
  } else if (mode === "ingest") {
    const result = await watcher.ingestBridgeResults(deps);
    console.log(JSON.stringify({ updated: result.updated, escalated: result.escalated.length }, null, 1));
  } else if (mode === "stage") {
    const ledger = await deps.loadLedger();
    const records = Object.values(ledger).filter(Boolean);
    if (!records.length) {
      console.log("원장이 비어 있다 — 먼저 --cycle/--ingest로 검증값을 확보하라");
      return;
    }
    await deps.enqueueStagingWrite(
      bridge.buildStagingWriteRequest(records, `SW-MANUAL-${Date.now()}`, new Date().toISOString()),
    );
  } else {
    const ledger = await deps.loadLedger();
    const all = Object.values(ledger).filter(Boolean);
    const numeric = all.filter((r) => typeof r.stockQuantity === "number");
    const fresh = all.filter((r) => r.stockVerifiedAt && Date.now() - Date.parse(r.stockVerifiedAt) <= 24 * 3600_000);
    console.log(`원장 ${all.length}건 / 숫자재고 ${numeric.length}건 / 신선(24h) ${fresh.length}건 — 키 주입: ${process.env.DOMEGGOOK_API_KEY ? "있음" : "없음(bridge)"}`);
    for (const r of all.slice(0, 10)) {
      console.log(`  ${r.productId} ${r.stockStatus} qty=${r.stockQuantity === null ? "null" : r.stockQuantity} type=${r.stockType} at=${r.stockVerifiedAt}`);
    }
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
