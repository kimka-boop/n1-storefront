/**
 * [모듈 2-2] 주문 웹훅 리시버
 * POST /api/orders — 표준 주문 JSON 수령 → 검증 → 분리배송 판별 → Customers/Orders 시트 인입 → 재고 차감
 *
 * 스키마 v3 (Commerce Architecture Mission):
 * body: { customer: {name, phone, address | postal_code+address1+address2, delivery_memo?,
 *                    depositor, email?, member?},
 *         items: [{sku, color, size, qty}], source?: "cart"|"buynow",
 *         payment_method?: "bank_transfer"|"pg_card",      // 서버가 어댑터 상태로 최종 결정
 *         idempotency_key?: string }
 * 응답: { ok, order_id, customer_id, total_amount, payable_amount, payment_method, status,
 *         status_label, shipping: {type, notice}, deposit_info, payment?, duplicate? }
 *
 * 결제 계약 (미션 §2·§4·§7·§17):
 *  - 주문 ≠ 결제. 이 라우트는 주문 draft를 만든다. PAID로 가는 유일한 길은 서버측 결제 검증
 *    (무통장 = 운영자 대장 확인, PG = /api/payments/webhook 검증).
 *  - 클라이언트 결제수단·금액은 요청일 뿐. resolveServerPaymentMethod가 수용 여부를 결정하고
 *    금액은 시트 재판돈 최종 결제대금(상품금+배송비)으로 기록한다 (Price Authority).
 *  - pg_card + PG 미연결 → 시트 쓰기 이전에 PAYMENT_PROVIDER_NOT_CONFIGURED 로 정직 거절
 *    ("결제 시스템 준비 중입니다.") — 운영 Orders에 죽은 주문을 남기지 않는다.
 *  - PG 주문의 재고 차감은 결제 검증 후로 이연된다. 무통장 V1은 기존대로 주문 생성 시 차감.
 *
 * [Session C — 멱등성 §7] 2층 멱등(in-flight merge + Orders.멱등키 영구 replay) 유지.
 * [Session H — 최종 재고 확인 TASK 13] 결제 개시 직전 finalStockCheck 게이트 유지.
 * [Commerce Mission — §10] 검사→인입→차감 임계구역을 withOrderLock으로 직렬화 (경합 방어).
 * [Commerce Mission — §8] 주문 draft의 운영 이벤트를 HERMES_Events에 발행 (best-effort).
 */
import { NextResponse } from "next/server";
import {
  getDoc,
  getOrdersSheet,
  upsertCustomer,
  ensureOrdersContract,
  ensurePostalCellTextFormat,
  findOrderByIdempotencyKey,
  findOrdersByMemberEmail,
} from "@/lib/sheets";
import { DEFAULT_PAYMENT_METHOD, resolveServerPaymentMethod } from "@/lib/payments";
import { dispatchOrderEmail } from "@/lib/transactionalEmail";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { createPaymentRequestForOrder } from "@/lib/paymentFlow";
import { buildPaymentFlowDeps } from "@/lib/paymentFlowWiring";
import { withIdempotency } from "@/lib/idempotency";
import { withOrderLock } from "@/lib/orderLock";
import { projectOrderForOwner } from "@/lib/orderView";
import { displayLabel } from "@/lib/orderState";
import { getShippingFee } from "@/lib/checkout";
import { emitHermesEvent } from "@/lib/hermesEvents";
import { sendTelegramMessage } from "@/lib/telegram";
import { checkoutFinalStockCheck, decrementStagingStock, sheetOptionQty } from "@/lib/stockCheckout";
import { gateFromStockCheck, gateFromSheetStock, GateLine } from "@/lib/stockGate";
import { clientSafeRejection, clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

const DEPOSIT_ACCOUNT = {
  bank: "케이뱅크",
  account: "100127890230",
  holder: "김성빈",
  due_hours: 24,
};

// ── 디렉터 텔레그램 알림 (신규 주문 인입, 봇2: 결제·발주 전담) ──
async function notifyNewOrder(orderId: string, name: string, amount: number, shipType: string, itemsDesc: string) {
  const r = await sendTelegramMessage(
    process.env.N1_PAYMENT_BOT_TOKEN || "",
    process.env.N1_PAYMENT_CHAT_ID || "",
    `🛎️ N°1 신규 주문!\n\n주문번호: ${orderId}\n고객: ${name}\n상품: ${itemsDesc}\n금액: ${amount.toLocaleString()}원\n배송: ${shipType}\n→ 입금 확인 후 출고해주세요`,
  );
  if (!r.ok) console.warn("[orders] 디렉터 텔레그램 알림 미발송 (토큰 미설정 또는 전송 실패)");
}

interface OrderBody {
  customer?: {
    name?: string; phone?: string; address?: string;
    postal_code?: string; address1?: string; address2?: string; delivery_memo?: string;
    depositor?: string; email?: string; member?: boolean;
  };
  items?: { sku?: string; color?: string; size?: string; qty?: number; colorIndex?: number }[];
  source?: string;
  payment_method?: string;
  idempotency_key?: string;
}

interface ResolvedAddress {
  /** Orders.배송지 — 운영자가 읽는 단일 문자열 (구조화 입력 시 정규 조립) */
  full: string;
  postalCode: string;
  address1: string;
  address2: string;
  deliveryMemo: string;
}

function resolveAddress(customer: NonNullable<OrderBody["customer"]>): ResolvedAddress | null {
  const postal = String(customer.postal_code || "").trim();
  const a1 = String(customer.address1 || "").trim();
  const a2 = String(customer.address2 || "").trim();
  const memo = String(customer.delivery_memo || "").trim();
  if (a1) {
    const postalPart = postal ? `(${postal}) ` : "";
    return { full: `${postalPart}${a1}${a2 ? ` ${a2}` : ""}`, postalCode: postal, address1: a1, address2: a2, deliveryMemo: memo };
  }
  const legacy = String(customer.address || "").trim();
  if (legacy) return { full: legacy, postalCode: "", address1: "", address2: "", deliveryMemo: memo };
  return null;
}

interface CreateResult {
  payload: Record<string, unknown>;
  duplicate: boolean;
}

/** 주문 생성 본체 — 멱등키 기준 "키당 최초 1회"만 실행된다 */
async function createOrderRecord(body: OrderBody): Promise<CreateResult> {
  const { customer, items, source } = body || {};
  const idempotencyKey = String(body?.idempotency_key || "").trim();

  // ── 1. 결제수단 결정 (서버 권위 — 시트 접근 이전에 끝낸다) ──
  const { provider, livePgAvailable, configSummary } = resolvePaymentProvider();
  const methodDecision = resolveServerPaymentMethod(body?.payment_method, livePgAvailable);
  // ⚠️ tsconfig strict:false — truthiness(!ok)로 유니언이 좁혀지지 않는다. 판별자 비교로 좁힌다.
  if (methodDecision.ok === false) {
    // pg_card + PG 미연결 — 주문도 만들지 않는 정직 거절 (미션 §17). 503: 재시도 가능 상태 아님.
    throw Object.assign(new Error(methodDecision.customer_message), {
      status: 503,
      code: methodDecision.code,
    });
  }
  const paymentMethod = methodDecision.method;

  // ── 1.5 입력 검증 ──
  const addr = customer ? resolveAddress(customer) : null;
  if (!customer?.name || !customer?.phone || !addr || !Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("필수 항목 누락 (고객명/연락처/배송지/상품)"), { status: 400 });
  }

  const doc = await getDoc();
  const productsSheet = doc.sheetsByIndex[0]; // Products
  const pRows = await productsSheet.getRows();

  // ── 2. 서버 측 가격 재계산 (클라이언트 금액 신뢰 금지 — Price Authority §7) ──
  // 최종 결제대금 = 상품금(시트 판매가) + 배송비(규칙 동일) − 할인(미도입 0).
  // 이전까지 시트 total은 상품금만이었으나, 결제 대금은 서버가 끝까지 계산하는 것이 계약이다
  // (근거 분해는 상품금액/배송비/할인 컬럼으로 함께 기록).
  let subtotal = 0;
  const resolved: { sku: string; color: string; size: string; qty: number; unit_price: number; supplier: string; supplier_product_id: string; colorIndex: number; name: string }[] = [];
  for (const it of items) {
    const p = pRows.find((r) => r.get("상품ID") === it.sku);
    if (!p) throw Object.assign(new Error(`존재하지 않는 상품: ${it.sku}`), { status: 400 });
    const price = Number(String(p.get("판매가") || "0").replace(/[^\d]/g, "")) || 0;
    const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
    subtotal += price * qty;
    resolved.push({ sku: it.sku, color: it.color || "", size: it.size || "", qty, unit_price: price, supplier: String(p.get("공급사명") || ""), supplier_product_id: String(p.get("공급사코드") || ""), colorIndex: (typeof it.colorIndex === "number" ? it.colorIndex : -1), name: String(p.get("상품명") || it.sku) });
  }
  const shippingFee = getShippingFee(subtotal);
  const discount = 0;
  const payable = subtotal + shippingFee - discount;

  // ── 3. 분리배송 판별 (공급사명 기준 그룹핑) ──
  const supplierSet = new Set(resolved.map((r) => r.supplier));
  const suppliers = Array.from(supplierSet);
  const shipType = suppliers.length > 1 ? "분리배송" : "단일배송";

  // ── 3.5 멱등키 영구 방어 — 이미 인입된 키면 원본 응답 replay (재고 재차감 없음) ──
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(doc, idempotencyKey);
    if (existing) {
      // 신규 행은 총결제금액=최종 결제대금. 구행(상품금만)은 배송비를 더해 같은 계약으로 응는다.
      const storedIsPayable = Boolean(existing.raw?.["상품금액"]);
      const replayPayable = storedIsPayable ? existing.total : existing.total + getShippingFee(existing.total);
      return {
        duplicate: true,
        payload: {
          ok: true,
          order_id: existing.orderId,
          customer_id: existing.customerId,
          payment_method: existing.paymentMethod || DEFAULT_PAYMENT_METHOD,
          status: "PAYMENT_PENDING",
          status_label: displayLabel("PAYMENT_PENDING"),
          total_amount: existing.total,
          payable_amount: replayPayable,
          shipping: {
            type: existing.shipType,
            notice: existing.shipType === "분리배송"
              ? "고객님의 주문 상품은 신속한 출고를 위해 각각 개별 포장되어 순차 발송됩니다."
              : undefined,
          },
          deposit_info: {
            ...DEPOSIT_ACCOUNT,
            amount: replayPayable,
            depositor: existing.depositor || existing.customerName,
          },
        },
      };
    }
  }

  // ── 4~6. 임계구역: 재고 게이트 → 주문 인입 → 재고 차감 (경합 직렬화 — 미션 §10) ──
  const createOutcome = await withOrderLock(async () => {
    // ── 4. [SESSION H · TASK 13] 결제 개시 직전 최종 재고 확인 ──
    const gateLines: GateLine[] = resolved.map((r) => ({ sku: r.sku, color: r.color, size: r.size, qty: r.qty, name: r.name }));
    const stockCheck = await checkoutFinalStockCheck(gateLines);
    const pipelineGate = gateFromStockCheck(stockCheck, gateLines);
    if (pipelineGate && !pipelineGate.ok) {
      throw Object.assign(new Error(pipelineGate.message), { status: 409 });
    }
    if (!pipelineGate) {
      const rowBySku = new Map(pRows.map((r) => [String(r.get("상품ID")), r] as const));
      const sheetGate = gateFromSheetStock(gateLines, (line) => {
        const row = rowBySku.get(line.sku);
        return row ? sheetOptionQty(row, line) : undefined;
      });
      if (!sheetGate.ok) {
        throw Object.assign(new Error(sheetGate.message), { status: 409 });
      }
    }

    // ── 5. 고객 레코드 upsert (Customers 시트 — 회원/게스트 구분, 실패 시 빈 참조로 계속) ──
    const isMember = Boolean(customer.member && customer.email);
    const { customerId } = await upsertCustomer(doc, {
      name: customer.name!,
      phone: customer.phone!,
      email: isMember ? customer.email : "",
      type: isMember ? "MEMBER" : "GUEST",
    });

    // ── 6. 주문번호 생성 + 시트 인입 ──
    // N1_PG_TEST_ONLY=true 인 테스트 인스턴스는 TEST- 네임스페이스로 격리한다 —
    // 합성 PG(test_only)가 TEST- 주문만 수용하므로 운영 주문과 구조적으로 만날 수 없다.
    const testInstance = (process.env.N1_PG_TEST_ONLY || "").trim().toLowerCase() === "true";
    const idPrefix = testInstance ? "TEST" : "ORD";
    const now = new Date();
    const orderId = `${idPrefix}-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(now.getMilliseconds()).padStart(3, "0")}${String(Math.floor(Math.random() * 90) + 10)}`;
    const ordersSheet = await getOrdersSheet(doc);
    if (!ordersSheet) {
      console.error("[orders] Orders 시트 탭을 찾지 못했습니다");
      throw Object.assign(new Error("주문 접수 중 문제가 발생했습니다"), { status: 500 });
    }
    // ORD-0 수리 + 확장 컬럼 보장 — 한국어 계약 헤더 없으면 백업 탭 후 개명 마이그레이션
    await ensureOrdersContract(doc);
    // 우편번호 앞자리 0 보존 — 이후 row.save()가 행 전체를 USER_ENTERED 재기록하므로
    // 셀 형식을 TEXT로 고정하지 않으면 "06236"이 재파싱되어 6236이 된다 (실측 결함).
    const addedRow = await ordersSheet.addRow({
      "주문번호": orderId,
      "주문일시": now.toISOString(),
      "결제수단": paymentMethod,
      "결제상태": paymentMethod === "pg_card" ? "결제대기" : "입금대기",
      "입금자명": customer.depositor || customer.name,
      "PG거래ID": "",
      "고객ID": customerId,
      "고객명": customer.name,
      "연락처": customer.phone,
      "배송지": addr.full,
      "우편번호": addr.postalCode ? `'${addr.postalCode}` : "", // 앞자리 0 보존 (USER_ENTERED apostrophe = text 마커)
      "주소1": addr.address1,
      "주소2": addr.address2,
      "배송메모": addr.deliveryMemo,
      "고객이메일": String(customer.email || ""), // 게스트도 주문 안내 이메일 수신 (§13·§15)
      "고객유형": isMember ? "MEMBER" : "GUEST", // §14 — 주문 행 자체에 고객 정체성 기록
      "테스트구분": idPrefix === "TEST" ? "TEST_ONLY" : "",
      "주문출처": source === "buynow" ? "buynow" : "cart",
      "주문항목": JSON.stringify(resolved),
      "상품금액": String(subtotal),
      "배송비": String(shippingFee),
      "할인": String(discount),
      "총결제금액": String(payable),
      "배송유형": shipType,
      "출고그룹": suppliers.join(", "),
      "알림발송": shipType === "분리배송" ? "대기" : "-",
      "배송상태": "접수",
      "택배사": "",
      "송장번호": "",
      "공급사주문번호": "", // §17 — TestSupplierAdapter 바인딩 (PHASE G)
      "공급사발주시각": "",
      "출고시각": "",
      "배송중시각": "",
      "도착시각": "",
      "최종배송확인시각": "",
      "배송이메일발송시각": "",
      "배송이메일상태": "",
      "CS메모": "",
      ...(idempotencyKey ? { "멱등키": idempotencyKey } : {}),
    });
    try {
      await ensurePostalCellTextFormat(ordersSheet, addedRow.rowNumber);
    } catch (e) {
      console.warn("[orders] 우편번호 TEXT 형식 지정 실패 (주문 흐름 유지):", (e as Error).message);
    }

    // ── 7. 재고 차감 — PG 주문은 결제 검증 후로 이연, 무통장은 즉시 (미션 §19~22) ──
    if (paymentMethod === "bank_transfer") {
      const decrement = await decrementStagingStock(gateLines, orderId);
      console.log(
        `[stock-decrement] ${orderId} — staging 차감: [${decrement.decremented.join(", ") || "없음"}] 보류: [${decrement.skipped.join(", ") || "없음"}]`,
      );
    } else {
      console.log(`[stock-decrement] ${orderId} — PG 결제수단: 차감을 결제 검증 후로 이연`);
    }

    return { orderId, customerId, isMember };
  });

  const { orderId, customerId, isMember } = createOutcome;

  // ── 8. 운영 이벤트 (HERMES) — best-effort, 고객 흐름 차단 없음 ──
  await emitHermesEvent(() => getDoc(), {
    eventType: "ORDER_DRAFTED",
    orderId,
    amount: payable,
    payload: {
      payment_method: paymentMethod,
      ship_type: shipType,
      source: source === "buynow" ? "buynow" : "cart",
      customer_type: isMember ? "MEMBER" : "GUEST",
    },
  });

  // ── 9. 봇2 알림 — 무통장만 즉시 (PG는 결제 확정 알림이 webhook 경로에서 간다) ──
  const itemsDesc = resolved.map((r) => `${r.sku}(${r.color}${r.size ? " " + r.size : ""})x${r.qty}`).join(", ");
  if (paymentMethod === "bank_transfer") {
    await notifyNewOrder(orderId, customer.name!, payable, shipType, itemsDesc);
  }

  // §54·§62 — 주문 확인 이메일 (멱등 마커, bridge 큐). 실패가 주문을 바꾸지 않는다.
  try {
    const emailRecord = {
      orderId,
      orderTime: new Date().toISOString(),
      paymentMethod,
      paymentStatus: paymentMethod === "pg_card" ? "결제대기" : "입금대기",
      depositor: customer.depositor || customer.name,
      customerName: customer.name!,
      customerPhone: customer.phone!,
      customerAddress: addr.full,
      customerId,
      itemsJson: JSON.stringify(resolved),
      total: payable,
      shipType,
      shipStatus: "접수",
      carrier: "",
      trackingNo: "",
      csMemo: "",
      raw: {
        "고객이메일": String(customer.email || ""),
        "상품금액": String(subtotal),
        "배송비": String(shippingFee),
      },
    };
    await dispatchOrderEmail(await getDoc(), emailRecord, "order_confirmation");
  } catch (e) {
    console.warn("[orders] 주문 확인 이메일 큐 실패 (주문 흐름 유지):", (e as Error).message);
  }

  // ── 10. 고객 응답 ──
  const basePayload: Record<string, unknown> = {
    ok: true,
    order_id: orderId,
    customer_id: customerId,
    payment_method: paymentMethod,
    status: "PAYMENT_PENDING", // canonical — 생성 직후 유일한 합법 상태 (PAID는 검증 후에만)
    status_label: displayLabel("PAYMENT_PENDING"),
    total_amount: subtotal, // 하위호환 — 상품금 합계 (이전 계약 유지)
    payable_amount: payable, // 최종 결제대금 — 서버 계산 (클라이언트 표시·입금 기준)
    shipping: {
      type: shipType,
      notice: shipType === "분리배송"
        ? "고객님의 주문 상품은 신속한 출고를 위해 각각 개별 포장되어 순차 발송됩니다."
        : undefined,
    },
  };

  if (paymentMethod === "bank_transfer") {
    basePayload.deposit_info = {
      ...DEPOSIT_ACCOUNT,
      amount: payable,
      depositor: customer.depositor || customer.name,
    };
    return { duplicate: false, payload: basePayload };
  }

  // ── pg_card: PG 결제 요청 생성 (어댑터는 이미 live로 수용된 상태) ──
  console.log(`[orders] PG payment request — ${orderId} provider=${provider.name} (${configSummary})`);
  const deps = await buildPaymentFlowDeps(provider);
  const payment = await createPaymentRequestForOrder(deps, orderId);
  if (!payment.ok) {
    // 주문은 PAYMENT_PENDING 으로 존재 — 고객은 재시도 가능(/api/payments/request), 거짓 성공 없음
    basePayload.payment = { ok: false, code: payment.payload.code, error: payment.payload.error };
    return { duplicate: false, payload: basePayload };
  }
  basePayload.payment = { ok: true, ...payment.payload };
  return { duplicate: false, payload: basePayload };
}

export async function POST(req: Request) {
  try {
    // ⚠️ Vercel edge에서 한글 mojibake 방지: text → UTF-8 명시 파싱
    const raw = await req.text();
    const body = JSON.parse(raw) as OrderBody;
    const idempotencyKey = String(body?.idempotency_key || "").trim();
    // 멱등키 없는 레거시 클라이언트는 기존처럼 1회 실행 (호환 유지)
    const { value, replayed } = await withIdempotency(
      "orders.create",
      idempotencyKey || "",
      () => createOrderRecord(body),
    );
    const isDuplicate = replayed || value.duplicate;
    return NextResponse.json(
      isDuplicate ? { ...value.payload, duplicate: true } : value.payload,
    );
  } catch (e: unknown) {
    // [SESSION L · TASK 29] 위생 계약 — 라우트는 clientSafeRejection 결과만 응답에 실는다.
    // code가 붙은 계약 거절(PAYMENT_PROVIDER_NOT_CONFIGURED 등)은 원래 상태(503)와
    // 고객 문구("결제 시스템 준비 중입니다.")를 유지하고, 그 외 5xx는 고정 문구로 치환된다.
    const rejection = clientSafeRejection(e);
    return NextResponse.json(
      {
        ok: false,
        ...(rejection.code ? { code: rejection.code } : {}),
        error: rejection.message,
      },
      { status: rejection.status },
    );
  }
}

// ── [Session C §9] 회원 주문내역 — 로그인 사용자 본인 주문만 ──
export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });
    }
    // auth core의 세션 저장소(global __userStore.sessions)를 "읽기만" 사용 — 수정 없음
    const email = global.__userStore?.sessions?.[token];
    if (!email) {
      return NextResponse.json({ ok: false, error: "세션이 만료되었습니다" }, { status: 401 });
    }
    const doc = await getDoc();
    const records = await findOrdersByMemberEmail(doc, email, 50);
    const orders = records
      .map((r) => projectOrderForOwner(r))
      .sort((a, b) => (a.order_time < b.order_time ? 1 : -1));
    return NextResponse.json({ ok: true, email, orders });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
