/**
 * N°1 Stock 원장(ledger) — 워처 로컬 미러 + 감사 로그 (파일 I/O 유일 지점)
 *
 * 위치: mission-20260909/N1_STOCK_BRIDGE/ledger.json
 * - 시트(Stock_Staging)가 source of truth. 원장은 워처 작업 상태·staging 이전 전 미러·감사용.
 * - /api/stock은 시트 우선, 시트 탭 부재 시 원장 미러로 정직 폴백(staged:false로 표시).
 * - 병합은 mergeRecords(최신 stock_verified_at 승) — 워처와 API가 같은 규칙을 쓴다.
 */
import fs from "fs";
import path from "path";
import { StockRecord } from "./types";
import { mergeRecords } from "./normalize";

export const BRIDGE_DIR = path.join("mission-20260909", "N1_STOCK_BRIDGE");
export const LEDGER_PATH = path.join(BRIDGE_DIR, "ledger.json");
export const AUDIT_PATH = path.join(BRIDGE_DIR, "audit.log");
export const OUTBOUND_DIR = path.join(BRIDGE_DIR, "outbound");
export const INBOUND_DIR = path.join(BRIDGE_DIR, "inbound");
export const ESCALATION_DIR = path.join(BRIDGE_DIR, "escalations");

export function resolveLedgerPath(base?: string): string {
  return base ? base : path.join(process.cwd(), LEDGER_PATH);
}

export async function loadLedgerFile(file: string = resolveLedgerPath()): Promise<Record<string, StockRecord>> {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, StockRecord>;
  } catch {
    return {}; // 부재/손상 = 빈 원장 (창작 없음)
  }
}

export async function saveLedgerFile(
  ledger: Record<string, StockRecord>,
  file: string = resolveLedgerPath(),
): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 1), "utf-8");
}

/** 원장 병합 (외부 갱신분 포함) — 최신 검증 시각 승 */
export function mergeLedger(
  base: Record<string, StockRecord>,
  incoming: StockRecord[],
): { ledger: Record<string, StockRecord>; changed: string[] } {
  const next: Record<string, StockRecord> = { ...base };
  const changed: string[] = [];
  for (const rec of incoming) {
    const merged = mergeRecords(base[rec.productId] ?? null, rec);
    if (merged !== base[rec.productId]) changed.push(rec.productId);
    next[rec.productId] = merged;
  }
  return { ledger: next, changed };
}

/** 감사 로그 — 사람이 읽는 1줄/이벤트 (재검증 추적성) */
export function appendAudit(lines: string[], file: string = path.join(process.cwd(), AUDIT_PATH)): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, lines.join("\n") + "\n", "utf-8");
  } catch {
    // 감사 로그 실패가 워처를 막지 않는다 — 원장이 진실의 기록
  }
}
