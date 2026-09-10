/**
 * N°1 HERMES SHIPPING WATCHER (미션 §20–§25·§67–§68)
 *
 * 스케줄: 6시간 주기 (§20). 폴링 대상은 비단말 상태 주문만 —
 * SUPPLIER_PROCESSING / SHIPPED / IN_TRANSIT / DELIVERY_EXCEPTION.
 * DELIVERED·취소·환불 완료 주문은 폴링 집합에서 제외된다 (낭비 폴링 금지).
 *
 * 사이클 (§22):
 *   공급사 매핑 로드 → 공급사 배송 상태 조회 → 운송장/캐리어 취득 →
 *   외부 상태 정규화 → 이전 상태와 비교 → SSOT 갱신 → 의미 전이에서만 이벤트.
 *   매 사이클 최종배송확인시각을 갱신한다.
 *
 * 안전 경계:
 *  - 공급사 어댑터가 해석되지 않는 주문(실공급사 어댑터 미연결)은 건드리지 않는다.
 *  - TestSupplierAdapter는 TEST- 네임스페이스 주문만 수용 → 실주문 오염 구조적으로 불가.
 *  - 첫 타임스탬프 보존 (§23): 출고/도착 시각은 이미 값이 있으면 덮지 않는다.
 *  - 배송 시작 이메일은 마커 컬럼으로 멱등 (§24) — 반복 폴링이 재발송하지 않는다.
 *  - 이메일 실패는 배송 진실을 바꾸지 않는다 (§24).
 */
import type { GoogleSpreadsheet } from "google-spreadsheet";
import { getOrdersSheet, type OrderRecord } from "@/lib/sheets";
import {
  resolveSupplierAdapter,
  getTestSupplierAdapter,
  type NormalizedShippingState,
} from "@/lib/supplierAdapter";
import { dispatchOrderEmail } from "@/lib/transactionalEmail";
import { emitHermesEvent } from "@/lib/hermesEvents";

export const SHIPPING_WATCHER_INTERVAL_MS = 6 * 3600 * 1000; // §20 — 6시간

interface WatchRow {
  row: import("google-spreadsheet").GoogleSpreadsheetRow;
  order: OrderRecord;
  orderId: string;
  suppliers: string[];
  paid: boolean;
  hasSupplierOrderNo: boolean;
  shippedAt: string;
  inTransitAt: string;
  deliveredAt: string;
}

function cell(row: WatchRow["row"], col: string): string {
  return String(row.get(col) || "").trim();
}

function safeItems(row: WatchRow["row"]): Array<{ supplier?: string; sku?: string; color?: string; size?: string; supplier_product_id?: string }> {
  try {
    return JSON.parse(cell(row, "주문항목") || "[]");
  } catch {
    return [];
  }
}

/** 결제상태 + 배송상태 + 타임스탬프로 폴링 대상/단말을 판정한다 */
function isPollable(w: WatchRow): boolean {
  const payStatus = cell(w.row, "결제상태");
  const shipStatus = cell(w.row, "배송상태");
  // 단말: 취소/환불 확정, 도착 기록 존재
  if (w.deliveredAt) return false;
  if (/취소|환불/.test(shipStatus)) return false;
  if (/취소완료|환불완료/.test(payStatus)) return false;
  // 미결제(입금대기) 주문은 공급처 진행 자체가 없다 — 제외
  if (/입금대기|결제대기/.test(payStatus)) return false;
  return true;
}

function collectWatchRows(doc: GoogleSpreadsheet): Promise<WatchRow[]> {
  return (async () => {
    const sheet = await getOrdersSheet(doc);
    if (!sheet) return [];
    const rows = await sheet.getRows();
    const out: WatchRow[] = [];
    for (const row of rows) {
      const orderId = cell(row, "주문번호");
      if (!orderId) continue;
      const w: WatchRow = {
        row,
        orderId,
        order: {
          orderId,
          orderTime: cell(row, "주문일시"),
          paymentMethod: cell(row, "결제수단"),
          paymentStatus: cell(row, "결제상태"),
          depositor: cell(row, "입금자명"),
          customerName: cell(row, "고객명"),
          customerPhone: cell(row, "연락처"),
          customerAddress: cell(row, "배송지"),
          customerId: cell(row, "고객ID"),
          itemsJson: cell(row, "주문항목"),
          total: Number(cell(row, "총결제금액").replace(/[^\d]/g, "")) || 0,
          shipType: cell(row, "배송유형"),
          shipStatus: cell(row, "배송상태"),
          carrier: cell(row, "택배사"),
          trackingNo: cell(row, "송장번호"),
          csMemo: cell(row, "CS메모"),
          raw: {},
        },
        suppliers: Array.from(new Set(safeItems(row).map((i) => String(i.supplier || "")).filter(Boolean))),
        paid: !/입금대기|결제대기/.test(cell(row, "결제상태")),
        hasSupplierOrderNo: Boolean(cell(row, "공급사주문번호")),
        shippedAt: cell(row, "출고시각"),
        inTransitAt: cell(row, "배송중시각"),
        deliveredAt: cell(row, "도착시각"),
      };
      out.push(w);
    }
    return out;
  })();
}

/** 저장된 타임스탬프에서 현재 정규 상태를 복원한다 (외부 상태 비교 기준) */
export function storedNormalizedState(w: { shippedAt: string; inTransitAt: string; deliveredAt: string }): NormalizedShippingState | null {
  if (w.deliveredAt) return "DELIVERED";
  if (w.inTransitAt) return "IN_TRANSIT";
  if (w.shippedAt) return "SHIPPED";
  return null;
}

export interface WatcherCycleResult {
  ran: boolean;
  polled: number;
  dryRunSupplierOrders: number;
  shipmentStarted: number;
  inTransit: number;
  delivered: number;
  skippedNoAdapter: number;
  emailsQueued: number;
  notes: string[];
}

/**
 * 1회 워처 사이클 (§22). TEST 틱 API와 6시간 인터벌 런타임이 함께 사용한다.
 * advance는 E2E 시뮬레이션(§71)용 — 지정 주문의 테스트 공급사 상태를 한 단계 진행한다.
 */
export async function runShippingWatcherCycle(
  openDoc: () => Promise<GoogleSpreadsheet>,
  opts: { advanceOrderId?: string } = {},
): Promise<WatcherCycleResult> {
  // §71 시뮬레이션 advance는 사이클 직렬화와 무관하게 항상 적용된다 —
  // 가드가 틱을 건너뛸 때 advance까지 삼키면 시뮬레이션 순서가 어긋난다 (실측 결함).
  if (opts.advanceOrderId) {
    if (!opts.advanceOrderId.startsWith("TEST-")) {
      // 시트 기록 없이 조용히 거절 — E2E 결과 notes로 전달된다
      return { ran: false, polled: 0, dryRunSupplierOrders: 0, shipmentStarted: 0,
        inTransit: 0, delivered: 0, skippedNoAdapter: 0, emailsQueued: 0,
        notes: ["advance 거절: TEST- 주문만 진행할 수 있습니다"] };
    }
    getTestSupplierAdapter().advanceTestShipping(opts.advanceOrderId);
  }
  // 사이클 직렬화 — 6h 인터벌·수동 틱이 겹치면 같은 행을 두 번 쓰고
  // 이메일 멱등 마커가 경합에서 지워진다 (실측 결함). 실행 중이면 이번 틱은 건너뛴다.
  if (watcherCycleInFlight) {
    return { ran: false, polled: 0, dryRunSupplierOrders: 0, shipmentStarted: 0,
      inTransit: 0, delivered: 0, skippedNoAdapter: 0, emailsQueued: 0, notes: ["cycle_already_running"] };
  }
  watcherCycleInFlight = true;
  try {
    return await runShippingWatcherCycleInner(openDoc, opts);
  } finally {
    watcherCycleInFlight = false;
  }
}

let watcherCycleInFlight = false;

async function runShippingWatcherCycleInner(
  openDoc: () => Promise<GoogleSpreadsheet>,
  opts: { advanceOrderId?: string } = {},
): Promise<WatcherCycleResult> {
  const result: WatcherCycleResult = {
    ran: true, polled: 0, dryRunSupplierOrders: 0, shipmentStarted: 0,
    inTransit: 0, delivered: 0, skippedNoAdapter: 0, emailsQueued: 0, notes: [],
  };
  const doc = await openDoc();

  // ── §68 결제→발주 드라이런: 결제확정 + 미발주 주문을 공급사 어댑터로 발주 (TEST 격리) ──
  const all = await collectWatchRows(doc);
  for (const w of all) {
    if (!w.paid || w.hasSupplierOrderNo || w.suppliers.length === 0) continue;
    const adapter = resolveSupplierAdapter(w.suppliers[0]);
    if (!adapter) continue; // 실공급사 어댑터 미연결 — MANUAL 경계 (§45), 오염 없음
    if (!adapter.test_only) continue; // 현 세션: 실발주 금지 (PRODUCTION FREEZE)
    try {
      const items = safeItems(w.row);
      const res = await adapter.createOrder({
        n1_order_id: w.orderId,
        supplier_platform: "test_supplier",
        supplier_name: w.suppliers[0],
        supplier_product_id: String(items[0]?.supplier_product_id || w.orderId),
        supplier_raw_option: `${String(items[0]?.color || "")}/${String(items[0]?.size || "")}`.replace(/^\/$/, ""),
        qty: 1,
        ship_to: {
          recipient_name: w.order.customerName,
          recipient_phone: w.order.customerPhone,
          postal_code: cell(w.row, "우편번호").replace(/\D/g, "").padStart(5, "0").slice(-5), // 앞자리 0 복원
          road_address: cell(w.row, "주소1"),
          detail_address: cell(w.row, "주소2"),
          delivery_memo: cell(w.row, "배송메모") || undefined,
        },
      });
      if (res.ok) {
        w.row.set("공급사주문번호", res.supplier_order_no);
        w.row.set("공급사발주시각", res.ordered_at);
        w.row.set("배송상태", "공급처처리중");
        await w.row.save();
        result.dryRunSupplierOrders += 1;
        await emitHermesEvent(openDoc, {
          eventType: "SUPPLIER_ORDER_DRYRUN",
          orderId: w.orderId,
          payload: { test_only: true, supplier_order_no: res.supplier_order_no, adapter: adapter.name },
        });
      }
    } catch (e) {
      result.notes.push(`dryrun ${w.orderId}: ${(e as Error).message}`);
    }
  }


  // ── §22 폴링 사이클 — 비단말 주문만 ──
  for (const w of all) {
    if (!isPollable(w)) continue;
    if (!w.hasSupplierOrderNo) continue; // 발주 전 — 폴링 의미 없음
    const adapter = resolveSupplierAdapter(w.suppliers[0]);
    if (!adapter) { result.skippedNoAdapter += 1; continue; }
    result.polled += 1;
    try {
      const snap = await adapter.getShippingState(w.orderId);
      const prev = storedNormalizedState(w);
      const now = new Date().toISOString();
      w.row.set("최종배송확인시각", now); // §22 — 매 사이클 갱신

      // SHIPPED 전이 (§23) — 첫 운송장. 첫 타임스탬프 보존.
      if (snap.state === "SHIPPED" || ((snap.state === "IN_TRANSIT" || snap.state === "DELIVERED") && !w.shippedAt)) {
        if (!w.shippedAt) {
          w.row.set("출고시각", now);
          w.row.set("배송상태", "배송중");
        }
        if (snap.tracking_no && !cell(w.row, "송장번호")) w.row.set("송장번호", snap.tracking_no);
        if (snap.carrier && !cell(w.row, "택배사")) w.row.set("택배사", snap.carrier);
        if (prev !== "SHIPPED" && prev !== "IN_TRANSIT" && prev !== "DELIVERED") {
          result.shipmentStarted += 1;
          await emitHermesEvent(openDoc, {
            eventType: "SHIPMENT_STARTED",
            orderId: w.orderId,
            payload: { carrier: snap.carrier ?? "", tracking_no: snap.tracking_no ?? "", test_only: adapter.test_only },
          });
          // §24 — 배송 시작 이메일 (마커 멱등, 실패는 진실 불변)
          const mail = await dispatchOrderEmail(doc, { ...w.order, raw: rowRaw(w.row) }, "shipment_started", {
            carrier: snap.carrier ?? undefined,
            trackingNo: snap.tracking_no ?? undefined,
            shippedAt: now,
          });
          if (mail.sent) result.emailsQueued += 1;
        }
      }

      // IN_TRANSIT 전이
      if (snap.state === "IN_TRANSIT" && !w.inTransitAt) {
        w.row.set("배송중시각", now);
        if (/공급처처리중|접수/.test(cell(w.row, "배송상태"))) w.row.set("배송상태", "배송중");
        result.inTransit += 1;
      }

      // DELIVERED 전이 (§25) — 확인된 최종 수령. 이후 폴링 집합에서 제외된다.
      if (snap.state === "DELIVERED" && !w.deliveredAt) {
        w.row.set("도착시각", now);
        w.row.set("배송상태", "배송완료");
        result.delivered += 1;
        await emitHermesEvent(openDoc, {
          eventType: "DELIVERED_CONFIRMED",
          orderId: w.orderId,
          payload: { test_only: adapter.test_only },
        });
      }

      await w.row.save();
    } catch (e) {
      result.notes.push(`poll ${w.orderId}: ${(e as Error).message}`);
    }
  }
  return result;
}

/** 행의 현재 값들을 OrderRecord 형태로 (이메일 렌더러용) */
function rowRaw(row: WatchRow["row"]): Record<string, string> {
  const cols = [
    "주문번호", "주문일시", "결제수단", "결제상태", "입금자명", "고객명", "연락처", "배송지",
    "고객ID", "주문항목", "상품금액", "배송비", "총결제금액", "고객이메일", "고객유형", "테스트구분",
  ];
  const raw: Record<string, string> = {};
  for (const c of cols) raw[c] = String(row.get(c) ?? "");
  return raw;
}

// ── 런타임 — 6시간 인터벌 싱글턴 (env 게이트, 기본 OFF) ─────────────────────────
// N1_SHIPPING_WATCHER_ENABLED=true 인 인스턴스에서만 자동 구동된다.
// 프로덕션 배포 동결 하 현재는 로컬 RC(TEST_ONLY)에서만 켠다.

let runtimeStarted = false;

export function ensureShippingWatcherRuntime(openDoc: () => Promise<GoogleSpreadsheet>): boolean {
  const enabled = (process.env.N1_SHIPPING_WATCHER_ENABLED || "").trim().toLowerCase() === "true";
  if (!enabled || runtimeStarted) return false;
  runtimeStarted = true;
  const tick = async () => {
    try {
      const r = await runShippingWatcherCycle(openDoc);
      console.log("[shippingWatcher] cycle:", JSON.stringify({ ...r, notes: r.notes.slice(0, 3) }));
    } catch (e) {
      console.warn("[shippingWatcher] cycle 실패 (다음 주기 재시도):", (e as Error).message);
    }
  };
  setTimeout(tick, 5_000).unref?.(); // 기동 직후 1회
  setInterval(tick, SHIPPING_WATCHER_INTERVAL_MS).unref?.();
  console.log("[shippingWatcher] 런타임 구동 — 6h 주기 (§20)");
  return true;
}
