/**
 * N°1 Payment Flow — 주문↔결제 분리 오케스트레이션 (미션 §2·§18~§22)
 *
 * 캐노니컬 플로우에서 서버가 담당하는 구간을 의존성 주입으로 분리한 모듈이다.
 * 라우트(app/api/payments/*)는 실제 시트·Telegram 배선을 넣고, 테스트는 가짜를 넣는다 —
 * 같은 로직이 라이브와 검증에서 동일하게 돈다.
 *
 * 불변식 (위반 시 이 모듈이 거절한다):
 *  1. 결제 요청은 서버가 확정한 주문 draft 에서만 만들어진다 (state=PAYMENT_PENDING).
 *  2. 서버가 상품 시트를 다시 읽어 최종 결제대금을 계산한다 — 클라이언트 금액은 증거가 아니다.
 *     주문 저장 금액과 재계산 금액이 다르면 요청을 거절한다 (AMOUNT_MISMATCH).
 *  3. 주문 확정(PAID)은 PG 검증(서버→PG 조회)이 CONFIRMED를 돌려줄 때만 일어난다.
 *     webhook 본문의 금액·상태는 신뢰하지 않는다.
 *  4. 한 결제 레코드는 한 번만 CONFIRMED 된다 — 두 번째 webhook 은 duplicate 로 정직 응답.
 *  5. PG 주문의 재고 차감은 결제 검증 후로 이연된다 (무통장 V1은 기존대로 주문 생성 시 차감).
 */
import { getShippingFee } from "@/lib/checkout";
import { parseOrderItems, OrderRecordInput } from "@/lib/orderView";
import { toCanonicalStatus, assertTransition } from "@/lib/orderState";
import {
  PaymentProvider,
  ProviderVerification,
  PAYMENT_PROVIDER_NOT_CONFIGURED,
  CUSTOMER_MSG_PG_PREPARING,
} from "@/lib/paymentProvider";
import { PaymentRecord, genPaymentId } from "@/lib/paymentRecords";
import { derivePaymentState, paymentLabel, PaymentStatus } from "@/lib/paymentState";
import { HermesOrderEvent } from "@/lib/hermesEvents";
import { GateLine } from "@/lib/stockGate";
import { withOrderLock } from "@/lib/orderLock";
import { withInFlightMerge } from "@/lib/idempotency";

export interface PaymentFlowDeps {
  provider: PaymentProvider;
  loadOrder: (orderId: string) => Promise<OrderRecordInput | null>;
  /** 상품 시트 재판독 — Price Authority (존재하지 않는 sku는 null) */
  loadPrice: (sku: string) => Promise<{ price: number; name: string } | null>;
  createPayment: (input: {
    paymentId: string;
    orderId: string;
    provider: string;
    providerPaymentId: string;
    method: string;
    requestedAmount: number;
    currency: string;
    status: string;
    testFlag: string;
    requestedAt: string;
    providerPayloadRef: string;
  }) => Promise<{ ok: boolean; record: PaymentRecord }>;
  findPaymentsByOrder: (orderId: string) => Promise<PaymentRecord[]>;
  findPaymentByProviderPaymentId: (providerPaymentId: string) => Promise<PaymentRecord | null>;
  updatePayment: (
    paymentId: string,
    patch: {
      status: string;
      confirmedAmount?: number | null;
      failureCode?: string;
      failureMessage?: string;
      providerPaymentId?: string;
      providerPayloadRef?: string;
    },
  ) => Promise<{ ok: boolean }>;
  /** Orders 행: 결제상태=결제완료 + PG거래ID 기록. 이미 결제완료면 alreadyPaid. */
  confirmOrderPaid: (
    orderId: string,
    info: { paymentId: string; providerPaymentId: string; amount: number },
  ) => Promise<{ transitioned: boolean; alreadyPaid: boolean }>;
  /** PG 주문의 지연 재고 차감 (Stock_Staging 기준 — 기존 decrementStagingStock 주입) */
  decrementStock: (lines: GateLine[], orderId: string) => Promise<unknown>;
  emitEvent: (e: HermesOrderEvent) => Promise<boolean>;
  /** 봇2(N1 결제발주센터) 결제완료 알림 — 실패해도 흐름 유지 */
  notifyPaymentConfirmed: (info: {
    orderId: string;
    amount: number;
    provider: string;
    providerPaymentId: string;
    itemsDesc: string;
  }) => Promise<void>;
  now?: () => Date;
}

export interface FlowResult {
  ok: boolean;
  http: number;
  payload: Record<string, unknown>;
}

function fail(http: number, code: string, message: string, extra: Record<string, unknown> = {}): FlowResult {
  return { ok: false, http, payload: { ok: false, code, error: message, ...extra } };
}

function nowIso(deps: PaymentFlowDeps): string {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

/**
 * 최종 결제대금 재계산 — Price Authority.
 * 상품 시트에서 단가를 다시 은고, 배송비 규칙(lib/checkout 동일 계약)까지 더한
 * **최종 결제대금**을 돌려준다. 클라이언트가 보낸 금액은 입력으로도 취급하지 않는다.
 */
export async function recalcPayableAmount(
  deps: PaymentFlowDeps,
  itemsJson: string,
): Promise<{ ok: true; subtotal: number; shipping_fee: number; discount: number; payable: number }
  | { ok: false; reason: string }> {
  const { items, corrupt } = parseOrderItems(itemsJson);
  if (corrupt || items.length === 0) return { ok: false, reason: "ORDER_ITEMS_CORRUPT" };
  let subtotal = 0;
  for (const it of items) {
    const product = await deps.loadPrice(it.sku);
    if (!product) return { ok: false, reason: `PRODUCT_NOT_FOUND:${it.sku}` };
    // 시트 판매가가 주문 스냅샷과 달라진 경우 — 현재 시트가 최종 권위다 (미션 §7)
    subtotal += product.price * it.qty;
  }
  const shipping_fee = getShippingFee(subtotal);
  const discount = 0; // 할인 메커니즘 미도입 — 0은 "없음"의 정직한 값이다
  return { ok: true, subtotal, shipping_fee, discount, payable: subtotal + shipping_fee - discount };
}

// ── createPaymentRequest — 미션 §18 계약 ──

export async function createPaymentRequestForOrder(
  deps: PaymentFlowDeps,
  orderId: string,
  options?: {
    /** 세이브드 결제 수단 — 소유 검증(세션 이메일 일치)은 호출자가 끝낸 상태로 받는다 */
    savedMethod?: { methodId: string; providerBillingKey: string };
  },
): Promise<FlowResult> {
  const cleanId = String(orderId || "").trim();
  if (!cleanId) return fail(400, "ORDER_ID_REQUIRED", "order_id 누락");

  const order = await deps.loadOrder(cleanId);
  if (!order) return fail(404, "ORDER_NOT_FOUND", "주문을 찾을 수 없습니다");

  // 1. 결제수단 계약 — 무통장은 결제 요청 대상이 아니다 (운영자 입금 확인이 검증 계약)
  if (order.paymentMethod !== "pg_card") {
    return fail(400, "PAYMENT_REQUEST_NOT_APPLICABLE", "이 주문은 온라인 결제 요청 대상이 아닙니다");
  }

  // 2. 주문 상태 계약 — PAYMENT_PENDING 에서만 결제 개시
  const canonical = toCanonicalStatus({
    paymentStatus: order.paymentStatus,
    shipStatus: order.shipStatus,
  });
  if (canonical !== "PAYMENT_PENDING") {
    return fail(409, "ORDER_NOT_PENDING", "이 주문은 결제를 진행할 수 없는 상태입니다", {
      order_status: canonical,
    });
  }

  // 3. 금액 재계산 + 주문 저장 금액 대조
  const calc = await recalcPayableAmount(deps, order.itemsJson);
  // ⚠️ tsconfig strict:false — 판별자 비교로만 유니언이 좁혀진다
  if (calc.ok === false) {
    return fail(409, calc.reason.startsWith("PRODUCT_NOT_FOUND") ? "PRODUCT_UNAVAILABLE" : calc.reason,
      "주문 금액을 확인하지 못해 결제를 진행하지 못했습니다");
  }
  if (calc.payable !== order.total) {
    console.error(
      `[paymentFlow] AMOUNT_MISMATCH ${cleanId}: stored=${order.total} recalculated=${calc.payable} — 결제 요청 거절`,
    );
    return fail(409, "AMOUNT_MISMATCH", "주문 금액이 변경되었습니다 — 주문을 다시 진행해 주세요");
  }

  // 4. 열려 있는 시도 재사용 (한 주문에 열린 결제 시도는 동시에 1개)
  const attempts = await deps.findPaymentsByOrder(cleanId);
  const open = attempts.find((r) => ["CREATED", "PENDING", "AUTHORIZED"].includes(r.status));
  if (open) {
    return {
      ok: true,
      http: 200,
      payload: {
        ok: true,
        duplicate: true,
        payment_id: open.paymentId,
        provider: open.provider,
        status: open.status,
        amount: open.requestedAmount,
        currency: open.currency,
      },
    };
  }

  // 5. 결제 레코드(CREATED) → PG 어댑터 호출
  const testFlag = deps.provider.name === "test_only" ? "TEST_ONLY" : "";
  const created = await deps.createPayment({
    paymentId: genPaymentId(cleanId),
    orderId: cleanId,
    provider: deps.provider.name,
    providerPaymentId: "",
    method: "pg_card",
    requestedAmount: calc.payable,
    currency: "KRW",
    status: "CREATED",
    testFlag,
    requestedAt: nowIso(deps),
    providerPayloadRef: "",
  });
  const record = created.record;

  const items = parseOrderItems(order.itemsJson).items;
  const request = await deps.provider.createPaymentRequest({
    order_id: cleanId,
    amount: calc.payable,
    currency: "KRW",
    order_name: items.map((i) => i.name).join(", ").slice(0, 80) || cleanId,
    customer_name: order.customerName,
    customer_email: String(order.raw?.["고객이메일"] || "") || undefined,
    saved_method: options?.savedMethod
      ? { method_id: options.savedMethod.methodId, provider_billing_key: options.savedMethod.providerBillingKey }
      : undefined,
  });

  if (!request.ok) {
    await deps.updatePayment(record.paymentId, {
      status: "FAILED",
      failureCode: request.code || "PROVIDER_REQUEST_FAILED",
      failureMessage: request.customer_message || "",
    });
    await deps.emitEvent({
      eventType: "PAYMENT_REQUEST_FAILED",
      orderId: cleanId,
      paymentId: record.paymentId,
      provider: deps.provider.name,
      amount: calc.payable,
      payload: { code: request.code || "PROVIDER_REQUEST_FAILED" },
    });
    return {
      ok: false,
      http: request.code === PAYMENT_PROVIDER_NOT_CONFIGURED ? 503 : 502,
      payload: {
        ok: false,
        code: request.code || "PROVIDER_REQUEST_FAILED",
        error: request.customer_message || "결제 요청이 접수되지 않았습니다",
        customer_message: request.customer_message || CUSTOMER_MSG_PG_PREPARING,
      },
    };
  }

  await deps.updatePayment(record.paymentId, {
    status: "PENDING",
    providerPaymentId: request.provider_payment_id || "",
    providerPayloadRef: request.raw_ref || "",
  });
  await deps.emitEvent({
    eventType: "PAYMENT_REQUESTED",
    orderId: cleanId,
    paymentId: record.paymentId,
    provider: deps.provider.name,
    amount: calc.payable,
    payload: { provider_payment_id: request.provider_payment_id || "" },
  });

  return {
    ok: true,
    http: 200,
    payload: {
      ok: true,
      payment_id: record.paymentId,
      order_id: cleanId,
      amount: calc.payable,
      currency: "KRW",
      provider: deps.provider.name,
      status: "PENDING",
      // 안전 투영만 노출 — 시크릿·내부 raw 없음
      checkout_url: request.checkout_url,
    },
  };
}

// ── webhook 수신 → 서버측 검증 → 주문 확정 — 미션 §19~§22 ──

export async function settlePaymentWebhook(
  deps: PaymentFlowDeps,
  input: { headers: Record<string, string>; rawBody: string; parsed?: { provider_payment_id?: string; order_id?: string } },
): Promise<FlowResult> {
  const { provider } = deps;
  // 1. 서명 계약 — 검증 실패 webhook 은 폐기한다 (재시도 유도 401)
  if (!provider.verifyWebhookSignature(input.headers, input.rawBody)) {
    return fail(401, "WEBHOOK_SIGNATURE_INVALID", "webhook signature invalid");
  }
  const providerPaymentId = String(input.parsed?.provider_payment_id || "").trim();
  if (!providerPaymentId) return fail(400, "PROVIDER_PAYMENT_ID_REQUIRED", "provider_payment_id 누락");

  // 2. 같은 PG 거래의 동시 도착 webhook 을 한 실행으로 수렴 — 결과는 캐시하지 않는다:
  //    PG는 상태 진행(PENDING→CONFIRMED)마다 webhook을 다시 보내고, 각 도착은
  //    새 검증이어야 한다. 영구 중복 확정 방어는 결제 레코드 상태(CONFIRMED → duplicate)다.
  return await withInFlightMerge("payments.webhook", providerPaymentId, () =>
    settleOnce(deps, providerPaymentId),
  );
}

async function settleOnce(deps: PaymentFlowDeps, providerPaymentId: string): Promise<FlowResult> {
  const record = await deps.findPaymentByProviderPaymentId(providerPaymentId);
  if (!record) {
    // 우리 레코드가 없는 webhook — 조용히 기록만 (존재 정보 노출 금지)
    console.warn(`[paymentFlow] webhook for unknown payment ${providerPaymentId}`);
    return fail(404, "PAYMENT_NOT_FOUND", "payment not found");
  }
  if (record.status === "CONFIRMED") {
    return { ok: true, http: 200, payload: { ok: true, duplicate: true, status: "CONFIRMED" } };
  }
  if (record.status === "FAILED" || record.status === "CANCELLED" || record.status === "REFUNDED") {
    return { ok: true, http: 200, payload: { ok: true, already_resolved: true, status: record.status } };
  }

  // 3. 서버측 검증 — PG에 직접 조회 (webhook 본문 금액·상태 미신뢰)
  const verification: ProviderVerification = await deps.provider.verifyPayment({
    payment_id: record.paymentId,
    provider_payment_id: providerPaymentId,
    order_id: record.orderId,
  });
  await deps.emitEvent({
    eventType: verification.ok ? "PAYMENT_VERIFIED" : "PAYMENT_FAILED",
    orderId: record.orderId,
    paymentId: record.paymentId,
    provider: record.provider,
    amount: verification.amount,
    payload: { provider_status: verification.status, failure_code: verification.failure_code || "" },
  });

  // 아직 PG 승인 전 — 종단이 아니므로 실패 처리보다 먼저 판정한다 (가장 정직한 상태)
  if (verification.status === "PENDING") {
    return { ok: true, http: 200, payload: { ok: true, status: "PENDING", payment_id: record.paymentId } };
  }

  if (!verification.ok || verification.status === "FAILED" || verification.status === "CANCELLED") {
    await deps.updatePayment(record.paymentId, {
      status: verification.status === "CANCELLED" ? "CANCELLED" : "FAILED",
      failureCode: verification.failure_code || "PROVIDER_NOT_CONFIRMED",
      failureMessage: verification.failure_message || "",
    });
    return {
      ok: true,
      http: 200,
      payload: {
        ok: true,
        status: verification.status === "CANCELLED" ? "CANCELLED" : "FAILED",
        payment_id: record.paymentId,
      },
    };
  }

  // 4. 금액 대조 — PG 확정 금액 ≠ 요청 금액이면 절대 확정하지 않는다
  if (typeof verification.amount === "number" && verification.amount !== record.requestedAmount) {
    console.error(
      `[paymentFlow] AMOUNT_MISMATCH ${record.orderId}: requested=${record.requestedAmount} provider=${verification.amount}`,
    );
    await deps.updatePayment(record.paymentId, {
      status: "FAILED",
      failureCode: "AMOUNT_MISMATCH",
      failureMessage: `requested=${record.requestedAmount} provider=${verification.amount}`,
    });
    await deps.emitEvent({
      eventType: "PAYMENT_FAILED",
      orderId: record.orderId,
      paymentId: record.paymentId,
      provider: record.provider,
      amount: verification.amount,
      payload: { code: "AMOUNT_MISMATCH" },
    });
    return fail(409, "AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다");
  }

  // 5. 확정 — AUTHORIZED(가승인)는 주문을 확정하지 않는다 (capture 계약은 PG 어댑터 몫)
  if (verification.status === "AUTHORIZED") {
    await deps.updatePayment(record.paymentId, { status: "AUTHORIZED" });
    return { ok: true, http: 200, payload: { ok: true, status: "AUTHORIZED", payment_id: record.paymentId } };
  }

  // CONFIRMED — 임계구역(주문 전이 + 지연 차감)을 주문 생성과 직렬화
  const result = await withOrderLock(async () => {
    const order = await deps.loadOrder(record.orderId);
    if (!order) {
      await deps.updatePayment(record.paymentId, {
        status: "FAILED",
        failureCode: "ORDER_MISSING",
      });
      return fail(409, "ORDER_NOT_FOUND", "주문을 찾을 수 없습니다");
    }
    const canonical = toCanonicalStatus({
      paymentStatus: order.paymentStatus,
      shipStatus: order.shipStatus,
    });
    if (canonical !== "PAYMENT_PENDING") {
      // 이미 운영자가 처리했거나 취소된 주문 — 중복 확정 없이 정직 응답
      return { ok: true, http: 200, payload: { ok: true, duplicate: true, order_status: canonical } };
    }
    assertTransition("PAYMENT_PENDING", "PAID");

    const confirmed = await deps.confirmOrderPaid(record.orderId, {
      paymentId: record.paymentId,
      providerPaymentId: providerPaymentId,
      amount: record.requestedAmount,
    });
    if (!confirmed.transitioned && !confirmed.alreadyPaid) {
      return fail(502, "ORDER_CONFIRM_WRITE_FAILED", "주문 확정 기록에 실패했습니다");
    }

    // 지연 재고 차감 (PG 주문만 여기 온다 — 무통장은 주문 생성 시 이미 차감)
    const items = parseOrderItems(order.itemsJson).items;
    await deps.decrementStock(
      items.map((i) => ({ sku: i.sku, color: i.color, size: i.size, qty: i.qty, name: i.name })),
      record.orderId,
    );

    await deps.updatePayment(record.paymentId, {
      status: "CONFIRMED",
      confirmedAmount: record.requestedAmount,
      providerPayloadRef: verification.raw_ref || record.providerPayloadRef,
    });
    await deps.emitEvent({
      eventType: "PAYMENT_CONFIRMED",
      orderId: record.orderId,
      paymentId: record.paymentId,
      provider: record.provider,
      amount: record.requestedAmount,
    });
    await deps.notifyPaymentConfirmed({
      orderId: record.orderId,
      amount: record.requestedAmount,
      provider: record.provider,
      providerPaymentId: providerPaymentId,
      itemsDesc: items.map((i) => `${i.sku}(${i.color}${i.size ? " " + i.size : ""})x${i.qty}`).join(", "),
    });
    return {
      ok: true,
      http: 200,
      payload: { ok: true, status: "CONFIRMED", order_id: record.orderId, payment_id: record.paymentId },
    };
  });
  return result;
}

// ── 결제 상태 공개 뷰 — /api/payments/status (주문 소유 검증은 라우트가 한다) ──

export async function getPaymentStatusView(
  deps: PaymentFlowDeps,
  order: OrderRecordInput,
): Promise<{ ok: true; payment: Record<string, unknown> } | { ok: false; http: number; code: string; message: string }> {
  const canonical = toCanonicalStatus({
    paymentStatus: order.paymentStatus,
    shipStatus: order.shipStatus,
  });
  if (order.paymentMethod === "pg_card") {
    const attempts = await deps.findPaymentsByOrder(order.orderId);
    const latest = attempts[0];
    return {
      ok: true,
      payment: {
        method: "pg_card",
        status: latest ? latest.status : derivePaymentState(order.paymentStatus),
        status_label: latest
          ? paymentStatusLabel(latest.status)
          : "결제 요청이 만들어지지 않았습니다",
        amount: order.total,
        currency: "KRW",
        payment_id: latest?.paymentId ?? "",
        order_status: canonical,
      },
    };
  }
  // 무통장 V1 — Orders.결제상태 문자열이 단일 진실 (운영자 갱신 계약). 매핑 읽기만 한다.
  const state = derivePaymentState(order.paymentStatus);
  return {
    ok: true,
    payment: {
      method: "bank_transfer",
      status: state,
      status_label: state === "PENDING" ? "입금 확인 대기" : paymentStatusLabel(state),
      amount: order.total,
      currency: "KRW",
      order_status: canonical,
    },
  };
}

function paymentStatusLabel(status: string): string {
  return paymentLabel(status as PaymentStatus) || status;
}
