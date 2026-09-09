/**
 * N°1 Payment Records — Payments 시트 접근 계층 (미션 §4·§18)
 *
 * PG 결제의 단일 진실. 주문(Orders)과 결제(Payments)는 다른 시트·다른 생명주기다.
 * - 한 레코드 = 한 번의 결제 시도. 재시도는 새 payment_id (실패는 종단 — lib/paymentState).
 * - 저장하는 것은 PG가 돌려준 안전 메타데이터뿐 — 카드번호·CVV 등 민감 데이터 필드 자체가 없다.
 * - Customers 시트 lazy-create 선례와 동일하게 탭을 보장한다. 실패는 throw 하지 않고
 *   호출자가 정책대로 진행할 수 있게 ok 플래그로 돌려준다(결제 기록 실패 ≠ 고객 주문 실패).
 */
import { GoogleSpreadsheet } from "google-spreadsheet";

export const PAYMENTS_SHEET = "Payments";

export const PAYMENT_HEADERS = [
  "payment_id",
  "주문번호",
  "provider",
  "provider_payment_id",
  "payment_method",
  "requested_amount",
  "confirmed_amount",
  "currency",
  "status",
  "test_flag",
  "requested_at",
  "confirmed_at",
  "failed_at",
  "cancelled_at",
  "failure_code",
  "failure_message",
  "provider_payload_ref",
];

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  provider: string;
  providerPaymentId: string;
  method: string;
  requestedAmount: number;
  confirmedAmount: number | null;
  currency: string;
  status: string;
  testFlag: string;
  requestedAt: string;
  confirmedAt: string;
  failedAt: string;
  cancelledAt: string;
  failureCode: string;
  failureMessage: string;
  providerPayloadRef: string;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function genPaymentId(orderId: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `PAY-${orderId}-${rand}`;
}

export async function getPaymentsSheet(doc: GoogleSpreadsheet) {
  const existing = doc.sheetsByTitle[PAYMENTS_SHEET];
  if (existing) return existing;
  return await doc.addSheet({ title: PAYMENTS_SHEET, headerValues: PAYMENT_HEADERS });
}

function rowToRecord(get: (h: string) => string): PaymentRecord {
  const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
  return {
    paymentId: str(get("payment_id")),
    orderId: str(get("주문번호")),
    provider: str(get("provider")),
    providerPaymentId: str(get("provider_payment_id")),
    method: str(get("payment_method")),
    requestedAmount: num(str(get("requested_amount"))),
    confirmedAmount: str(get("confirmed_amount")) === "" ? null : num(str(get("confirmed_amount"))),
    currency: str(get("currency")) || "KRW",
    status: str(get("status")),
    testFlag: str(get("test_flag")),
    requestedAt: str(get("requested_at")),
    confirmedAt: str(get("confirmed_at")),
    failedAt: str(get("failed_at")),
    cancelledAt: str(get("cancelled_at")),
    failureCode: str(get("failure_code")),
    failureMessage: str(get("failure_message")),
    providerPayloadRef: str(get("provider_payload_ref")),
  };
}

export async function createPaymentRecord(
  doc: GoogleSpreadsheet,
  input: Omit<PaymentRecord, "confirmedAt" | "failedAt" | "cancelledAt" | "failureCode" | "failureMessage">,
): Promise<{ ok: boolean; record: PaymentRecord }> {
  const record: PaymentRecord = {
    ...input,
    confirmedAt: "",
    failedAt: "",
    cancelledAt: "",
    failureCode: "",
    failureMessage: "",
  };
  try {
    const sheet = await getPaymentsSheet(doc);
    await sheet.addRow({
      payment_id: record.paymentId,
      "주문번호": record.orderId,
      provider: record.provider,
      provider_payment_id: record.providerPaymentId,
      payment_method: record.method,
      requested_amount: String(record.requestedAmount),
      confirmed_amount: record.confirmedAmount === null ? "" : String(record.confirmedAmount),
      currency: record.currency,
      status: record.status,
      test_flag: record.testFlag,
      requested_at: record.requestedAt,
      confirmed_at: "",
      failed_at: "",
      cancelled_at: "",
      failure_code: "",
      failure_message: "",
      provider_payload_ref: record.providerPayloadRef,
    });
    return { ok: true, record };
  } catch (e) {
    console.error("[paymentRecords] Payments 레코드 생성 실패", e instanceof Error ? e.message : e);
    return { ok: false, record };
  }
}

/** payment_id 로 조회 — 시트 오류는 throw (조회 실패와 미존재를 구분) */
export async function findPaymentById(doc: GoogleSpreadsheet, paymentId: string): Promise<PaymentRecord | null> {
  const sheet = await getPaymentsSheet(doc);
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("payment_id")) === paymentId);
  if (!hit) return null;
  return rowToRecord((h) => str(hit.get(h)));
}

/** 주문번호의 결제 시도 전체 (최신순) — 주문당 여러 시도가 있을 수 있다 */
export async function findPaymentsByOrderId(
  doc: GoogleSpreadsheet,
  orderId: string,
): Promise<PaymentRecord[]> {
  const sheet = await getPaymentsSheet(doc);
  const rows = await sheet.getRows();
  return rows
    .filter((r) => str(r.get("주문번호")) === orderId)
    .map((r) => rowToRecord((h) => str(r.get(h))))
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

/** PG가 발급한 거래번호로 조회 — webhook 검증의 첫 대조 지점 */
export async function findPaymentByProviderPaymentId(
  doc: GoogleSpreadsheet,
  providerPaymentId: string,
): Promise<PaymentRecord | null> {
  const clean = str(providerPaymentId);
  if (!clean) return null;
  const sheet = await getPaymentsSheet(doc);
  const rows = await sheet.getRows();
  const hit = rows.find((r) => str(r.get("provider_payment_id")) === clean);
  if (!hit) return null;
  return rowToRecord((h) => str(hit.get(h)));
}

/**
 * 아직 열려 있는(진행 가능한) 결제 시도 — CREATED/PENDING/AUTHORIZED.
 * 결제 요청 재호출 시 같은 시도를 재사용한다 (한 주문에 열린 시도는 동시에 1개).
 */
export function findOpenPayment(
  records: PaymentRecord[],
): PaymentRecord | null {
  return records.find((r) => ["CREATED", "PENDING", "AUTHORIZED"].includes(r.status)) ?? null;
}

/**
 * 결제 레코드 상태 갱신 — 상태머신(lib/paymentState)이 허용한 전이만 호출자가 넘긴다.
 * 시간 필드는 상태에 맞게 여기서 기록한다 (단일 쓰기 지점).
 */
export async function updatePaymentRecord(
  doc: GoogleSpreadsheet,
  paymentId: string,
  patch: {
    status: string;
    confirmedAmount?: number | null;
    confirmedAt?: string;
    failedAt?: string;
    cancelledAt?: string;
    failureCode?: string;
    failureMessage?: string;
    providerPaymentId?: string;
    providerPayloadRef?: string;
  },
): Promise<{ ok: boolean }> {
  try {
    const sheet = await getPaymentsSheet(doc);
    const rows = await sheet.getRows();
    const hit = rows.find((r) => str(r.get("payment_id")) === paymentId);
    if (!hit) return { ok: false };
    const now = new Date().toISOString();
    hit.set("status", patch.status);
    if (patch.status === "CONFIRMED") {
      hit.set("confirmed_at", patch.confirmedAt || now);
      if (typeof patch.confirmedAmount === "number") hit.set("confirmed_amount", String(patch.confirmedAmount));
    }
    if (patch.status === "FAILED") hit.set("failed_at", patch.failedAt || now);
    if (patch.status === "CANCELLED") hit.set("cancelled_at", patch.cancelledAt || now);
    if (patch.failureCode !== undefined) hit.set("failure_code", patch.failureCode);
    if (patch.failureMessage !== undefined) hit.set("failure_message", patch.failureMessage);
    if (patch.providerPaymentId) hit.set("provider_payment_id", patch.providerPaymentId);
    if (patch.providerPayloadRef) hit.set("provider_payload_ref", patch.providerPayloadRef);
    await hit.save();
    return { ok: true };
  } catch (e) {
    console.error("[paymentRecords] Payments 갱신 실패", paymentId, e instanceof Error ? e.message : e);
    return { ok: false };
  }
}
