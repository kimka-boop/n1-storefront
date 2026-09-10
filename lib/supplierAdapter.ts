/**
 * N°1 SUPPLIER ORDER ADAPTER BOUNDARY (미션 §44·§67)
 *
 * - 공급사 독립 인터페이스. 실제 공급사별 구현은 최종 공급사 선정 후 별도 어댑터로
 *   연결한다 — Domeggook 전용으로 전체를 재구축하지 않는다 (§44).
 * - TestSupplierAdapter는 유일한 현재 구현이며, 모든 응답은 TEST_ONLY다.
 *   실제 공급사 발주·배송·반품 외부 호출은 존재하지 않는다 (§1 PRODUCTION FREEZE).
 * - 상태 정규화 토큰(§20): SUPPLIER_PROCESSING | SHIPPED | IN_TRANSIT |
 *   DELIVERED | DELIVERY_EXCEPTION — watcher가 폴링 대상/종료 판정에 사용한다.
 */

export type NormalizedShippingState =
  | "SUPPLIER_PROCESSING"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DELIVERY_EXCEPTION";

export const TERMINAL_SHIPPING_STATES: NormalizedShippingState[] = ["DELIVERED"];

export interface SupplierOrderPayload {
  /** N°1 주문번호 (TEST- 네임스페이스만 허용) */
  n1_order_id: string;
  supplier_platform: string;
  supplier_name: string;
  supplier_product_id: string;
  /** 공급사 원본 옵션 — 이행을 위해 원문 그대로 유지 (미션 §17) */
  supplier_raw_option: string;
  qty: number;
  /** 최종 고객 배송 페이로드 (§68) */
  ship_to: {
    recipient_name: string;
    recipient_phone: string;
    postal_code: string;
    road_address: string;
    detail_address: string;
    delivery_memo?: string;
  };
}

export interface SupplierOrderResult {
  ok: boolean;
  test_only: true;
  supplier_order_no: string;
  ordered_at: string;
  error?: string;
}

export interface SupplierShippingSnapshot {
  state: NormalizedShippingState;
  raw_state: string;
  carrier: string | null; // 검증된 매핑이 없으면 null — 지어내지 않는다 (미션 §21)
  tracking_no: string | null;
}

export interface SupplierReturnResult {
  ok: boolean;
  test_only: true;
  supplier_return_no: string;
  error?: string;
}

export interface SupplierOrderAdapter {
  readonly name: string;
  readonly test_only: boolean;
  createOrder(payload: SupplierOrderPayload): Promise<SupplierOrderResult>;
  getShippingState(n1OrderId: string): Promise<SupplierShippingSnapshot>;
  requestReturn(n1OrderId: string, supplierOrderNo: string, reason: string): Promise<SupplierReturnResult>;
}

// ── TestSupplierAdapter — 결정론적 시뮬레이터 (TEST_ONLY) ──────────────────────
// 상태 머신은 시각이 아니라 "주문 경과 시뮬레이션 카운터"로만 움직인다:
// advanceTestShipping(orderId)가 호출될 때 한 단계씩 진행한다 (실시간 위장 금지).
// 따라서 E2E는 4개의 논리 사이클(§71)을 명시적으로 밟아 검증할 수 있다.

const STATE_SEQUENCE: NormalizedShippingState[] = [
  "SUPPLIER_PROCESSING",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
];

interface TestRecord {
  payload: SupplierOrderPayload;
  supplierOrderNo: string;
  orderedAt: string;
  step: number; // 0=미발주, 1..4 = STATE_SEQUENCE 인덱스 +1
  returns: { supplierReturnNo: string; reason: string; at: string };
}

const CARRIER_TEST = "N1테스트택배"; // 테스트 캐리어 — 실제 캐리어로 위장하지 않는다

export class TestSupplierAdapter implements SupplierOrderAdapter {
  readonly name = "test_supplier";
  readonly test_only = true;
  private records = new Map<string, TestRecord>();

  async createOrder(payload: SupplierOrderPayload): Promise<SupplierOrderResult> {
    if (!payload.n1_order_id.startsWith("TEST-")) {
      return {
        ok: false,
        test_only: true,
        supplier_order_no: "",
        ordered_at: "",
        error: "TestSupplierAdapter는 TEST- 주문만 수용합니다 (운영 주문 격리)",
      };
    }
    const now = new Date().toISOString();
    const supplierOrderNo = `TSUP-${Date.now().toString(36).toUpperCase()}`;
    this.records.set(payload.n1_order_id, {
      payload,
      supplierOrderNo,
      orderedAt: now,
      step: 1, // 발주 즉시 SUPPLIER_PROCESSING
      returns: { supplierReturnNo: "", reason: "", at: "" },
    });
    return { ok: true, test_only: true, supplier_order_no: supplierOrderNo, ordered_at: now };
  }

  async getShippingState(n1OrderId: string): Promise<SupplierShippingSnapshot> {
    const rec = this.records.get(n1OrderId);
    if (!rec || rec.step === 0) {
      return { state: "SUPPLIER_PROCESSING", raw_state: "TEST_미발주", carrier: null, tracking_no: null };
    }
    const state = STATE_SEQUENCE[Math.min(rec.step, 4) - 1];
    const shipped = rec.step >= 2;
    return {
      state,
      raw_state: `TEST_STEP_${rec.step}`,
      carrier: shipped ? CARRIER_TEST : null,
      tracking_no: shipped ? `TRKTEST${rec.payload.n1_order_id.replace(/\D/g, "")}` : null,
    };
  }

  async requestReturn(n1OrderId: string, _supplierOrderNo: string, reason: string): Promise<SupplierReturnResult> {
    const rec = this.records.get(n1OrderId);
    if (!rec) {
      return { ok: false, test_only: true, supplier_return_no: "", error: "테스트 발주 기록 없음" };
    }
    const no = `TSUPRET-${Date.now().toString(36).toUpperCase()}`;
    rec.returns = { supplierReturnNo: no, reason, at: new Date().toISOString() };
    return { ok: true, test_only: true, supplier_return_no: no };
  }

  // ── 시뮬레이션 제어 (E2E 전용 — watcher API가 TEST_ONLY 게이트로 호출) ──
  advanceTestShipping(n1OrderId: string): NormalizedShippingState | null {
    const rec = this.records.get(n1OrderId);
    if (!rec) return null;
    rec.step = Math.min(rec.step + 1, 4);
    return STATE_SEQUENCE[rec.step - 1];
  }

  hasRecord(n1OrderId: string): boolean {
    return this.records.has(n1OrderId);
  }
}

let testAdapterSingleton: TestSupplierAdapter | null = null;

/** 프로세스 싱글턴 — watcher·dry-run·E2E가 같은 시뮬레이터 상태를 공유한다 */
export function getTestSupplierAdapter(): TestSupplierAdapter {
  if (!testAdapterSingleton) testAdapterSingleton = new TestSupplierAdapter();
  return testAdapterSingleton;
}

/**
 * 어댑터 해석 — §44: 공급사별 구현은 미래 확장. 현재는 TEST 인스턴스에서만
 * test_supplier가 응답하고, 그 외엔 미연결을 정직하게 반환한다 (추측 발주 금지).
 */
export function resolveSupplierAdapter(platform: string): SupplierOrderAdapter | null {
  const testInstance = (process.env.N1_PG_TEST_ONLY || "").trim().toLowerCase() === "true";
  if (testInstance && (platform === "test_supplier" || platform === "도매꾹")) {
    return getTestSupplierAdapter();
  }
  return null; // 실공급사 어댑터 미연결 — MANUAL 경계로 처리된다 (§45)
}
