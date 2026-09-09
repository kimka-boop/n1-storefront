/**
 * [모듈 2-2] 주문 웹훅 리시버
 * POST /api/orders — 표준 주문 JSON 수령 → 검증 → 분리배송 판별 → Customers/Orders 시트 인입 → 재고 차감
 *
 * 스키마 v2 (PG 전환 대응): payment 블록만 교체하면 토스페이먼츠 연동 가능
 * body: { customer: {name, phone, address, depositor, email?, member?},
 *         items: [{sku, color, size, qty}], source?: "cart"|"buynow",
 *         idempotency_key?: string }
 * 응답: { ok, order_id, customer_id, total_amount, payment_method, status, status_label,
 *         shipping: {type, notice}, deposit_info, duplicate? }
 *
 * V1 결제수단은 무통장입금 고정(lib/payments DEFAULT_PAYMENT_METHOD) —
 * 클라이언트가 어떤 결제수단을 보내도 서버가 확정한다 (client 신뢰 금지).
 *
 * [Session C — 멱등성 §7]
 *  - 같은 idempotency_key 로 재요청(더블 클릭/새로고침 재제출/재시도)하면
 *    재고 재차감·시트 중복 인입·중복 알림 없이 원본 주문 응답을 replay 한다 (duplicate: true).
 *  - 1층: lib/idempotency in-flight 병합 (동시 요청 race 차단)
 *  - 2층: Orders 시트 `멱등키` 컬럼 조회 (인스턴스 무관 영구 방어 — 단일 진실)
 *
 * [Session C — 회원 주문내역 §9]
 *  - GET /api/orders?token=… — 세션 토큰의 계정 이메일과 일치하는(고객이메일) 주문만 조회.
 *    본인 주문이 아닌 것은 절대 내려가지 않는다. 토큰 없음/무효 → 401.
 *
 * [Session H — 최종 재고 확인 (TASK 13)]
 *  - 결제 개시(고객 upsert·Orders 인입·차감·알림) 직전에 finalStockCheck로 선택 옵션을
 *    재검증한다: B 파이프라인 확정 품절/수량부족 → 409로 결제 중단(카트 유지·truthful 메시지),
 *    미확정 → C 원본(Products 옵션별재고) 폴백 — 정확히 일치하는 키만, 없으면 "재고 미확인".
 *  - 재고 차감은 Stock_Staging 기준(검증 숫자만·검증일시 불변). Products AB열(unisex_score)
 *    기록은 제거했다 — 데이터 오염 방지.
 */
import { NextResponse } from "next/server";
import {
  getDoc,
  getOrdersSheet,
  upsertCustomer,
  ensureOrdersIdempotencyColumn,
  findOrderByIdempotencyKey,
  findOrdersByMemberEmail,
} from "@/lib/sheets";
import { DEFAULT_PAYMENT_METHOD } from "@/lib/payments";
import { withIdempotency } from "@/lib/idempotency";
import { projectOrderForOwner } from "@/lib/orderView";
import { displayLabel } from "@/lib/orderState";
import { sendTelegramMessage } from "@/lib/telegram";
import { checkoutFinalStockCheck, decrementStagingStock, sheetOptionQty } from "@/lib/stockCheckout";
import { gateFromStockCheck, gateFromSheetStock, GateLine } from "@/lib/stockGate";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

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
    depositor?: string; email?: string; member?: boolean;
  };
  items?: { sku?: string; color?: string; size?: string; qty?: number; colorIndex?: number }[];
  source?: string;
  idempotency_key?: string;
}

interface CreateResult {
  payload: Record<string, unknown>;
  duplicate: boolean;
}

/** 주문 생성 본체 — 멱등키 기준 "키당 최초 1회"만 실행된다 */
async function createOrderRecord(body: OrderBody): Promise<CreateResult> {
  const { customer, items, source } = body || {};
  const idempotencyKey = String(body?.idempotency_key || "").trim();
  // ── 1. 입력 검증 ──
  if (!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("필수 항목 누락 (고객명/연락처/배송지/상품)"), { status: 400 });
  }

  const doc = await getDoc();
  const productsSheet = doc.sheetsByIndex[0]; // Products
  const pRows = await productsSheet.getRows();

  // ── 2. 서버 측 가격 재계산 (클라이언트 금액 신뢰 금지 — Price Authority §8) ──
  // [SESSION H] 옵션별재고 확인은 이 루프에서 제거되고 3.7의 finalStockCheck 게이트로
  // 이동했다 — 결제 개시 직전 단일 시점에 B 파이프라인(확정) + C 원본(폴백) 순으로 판정한다.
  let total = 0;
  const resolved: { sku: string; color: string; size: string; qty: number; unit_price: number; supplier: string; colorIndex: number; name: string }[] = [];
  for (const it of items) {
    const p = pRows.find((r) => r.get("상품ID") === it.sku);
    if (!p) throw Object.assign(new Error(`존재하지 않는 상품: ${it.sku}`), { status: 400 });
    const price = Number(String(p.get("판매가") || "0").replace(/[^\d]/g, "")) || 0;
    const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
    total += price * qty;
    resolved.push({ sku: it.sku, color: it.color || "", size: it.size || "", qty, unit_price: price, supplier: String(p.get("공급사명") || ""), colorIndex: (typeof it.colorIndex === "number" ? it.colorIndex : -1), name: String(p.get("상품명") || it.sku) });
  }

  // ── 3. 분리배송 판별 (공급사명 기준 그룹핑) ──
  const supplierSet = new Set(resolved.map((r) => r.supplier));
  const suppliers = Array.from(supplierSet);
  const shipType = suppliers.length > 1 ? "분리배송" : "단일배송";

  // ── 3.5 멱등키 영구 방어 — 이미 인입된 키면 원본 응답 replay (재고 재차감 없음) ──
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(doc, idempotencyKey);
    if (existing) {
      const existingTotal = existing.total;
      return {
        duplicate: true,
        payload: {
          ok: true,
          order_id: existing.orderId,
          customer_id: existing.customerId,
          payment_method: existing.paymentMethod || DEFAULT_PAYMENT_METHOD,
          status: "PAYMENT_PENDING",
          status_label: displayLabel("PAYMENT_PENDING"),
          total_amount: existingTotal,
          shipping: {
            type: existing.shipType,
            notice: existing.shipType === "분리배송"
              ? "고객님의 주문 상품은 신속한 출고를 위해 각각 개별 포장되어 순차 발송됩니다."
              : undefined,
          },
          deposit_info: {
            ...DEPOSIT_ACCOUNT,
            amount: existingTotal,
            depositor: existing.depositor || existing.customerName,
          },
        },
      };
    }
  }

  // ── 3.7 [SESSION H · TASK 13] 결제 개시 직전 최종 재고 확인 (finalStockCheck) ──
  // 멱등키 replay 판정 *뒤*에 실행한다 — 이미 생성된 주문의 재제출은 재고 변동과 무관하게
  // 원본 응답을 replay한다. 게이트는 고객 upsert·Orders 인입·차감·알림(=결제 개시) 직전의
  // 마지막 경계다. 선택한 정확한 옵션(color×size) 단위로 재검증한다.
  const gateLines: GateLine[] = resolved.map((r) => ({ sku: r.sku, color: r.color, size: r.size, qty: r.qty, name: r.name }));
  const stockCheck = await checkoutFinalStockCheck(gateLines);
  const pipelineGate = gateFromStockCheck(stockCheck, gateLines);
  if (pipelineGate && !pipelineGate.ok) {
    // 확정 품절/수량 부족 — 결제 중단. 카트 비움은 성공 경로에서만 일어나므로 유지된다.
    throw Object.assign(new Error(pipelineGate.message), { status: 409 });
  }
  if (!pipelineGate) {
    // 어댑터 미확정(미스테이징·STALE·TYPE B 수량미확인·조회 실패) → C 원본(Products
    // 옵션별재고) 폴백. 정확히 일치하는 옵션 키만 읽는다 — 값이 없으면 "재고 미확인"으로
    // truthful 차단한다(품절로 창작 금지).
    const rowBySku = new Map(pRows.map((r) => [String(r.get("상품ID")), r] as const));
    const sheetGate = gateFromSheetStock(gateLines, (line) => {
      const row = rowBySku.get(line.sku);
      return row ? sheetOptionQty(row, line) : undefined;
    });
    if (!sheetGate.ok) {
      throw Object.assign(new Error(sheetGate.message), { status: 409 });
    }
  }

  // ── 4. 고객 레코드 upsert (Customers 시트 — 회원/게스트 구분, 실패 시 빈 참조로 계속) ──
  const isMember = Boolean(customer.member && customer.email);
  const { customerId } = await upsertCustomer(doc, {
    name: customer.name,
    phone: customer.phone,
    email: isMember ? customer.email : "",
    type: isMember ? "MEMBER" : "GUEST",
  });

  // ── 5. 주문번호 생성 + 시트 인입 ──
  const now = new Date();
  const orderId = `ORD-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(now.getMilliseconds()).padStart(3, "0")}${String(Math.floor(Math.random() * 90) + 10)}`;
  const ordersSheet = await getOrdersSheet(doc);
  if (!ordersSheet) {
    // [SESSION L] 내부 저장소 구조 문제 — 고객 메시지는 고정 문구로, 원문은 로그로만
    console.error("[orders] Orders 시트 탭을 찾지 못했습니다");
    throw Object.assign(new Error("주문 접수 중 문제가 발생했습니다"), { status: 500 });
  }
  if (idempotencyKey) await ensureOrdersIdempotencyColumn(doc);
  await ordersSheet.addRow({
    "주문번호": orderId,
    "주문일시": now.toISOString(),
    "결제수단": DEFAULT_PAYMENT_METHOD, // V1: 무통장입금 고정 (PG 연동 시 여기 교체)
    "결제상태": "입금대기",
    "입금자명": customer.depositor || customer.name,
    "PG거래ID": "",
    "고객ID": customerId,
    "고객명": customer.name,
    "연락처": customer.phone,
    "배송지": customer.address,
    "고객이메일": isMember ? String(customer.email) : "",
    "주문출처": source === "buynow" ? "buynow" : "cart",
    "주문항목": JSON.stringify(resolved),
    "총결제금액": String(total),
    "배송유형": shipType,
    "출고그룹": suppliers.join(", "),
    "알림발송": shipType === "분리배송" ? "대기" : "-",
    "배송상태": "접수",
    "택배사": "",
    "송장번호": "",
    "CS메모": "",
    ...(idempotencyKey ? { "멱등키": idempotencyKey } : {}),
  });

  // ── 6. [SESSION H] 재고 차감 — Stock_Staging 기준 ──
  // 기존 Products AB열(getCell(row,27)) 차감은 제거했다: 신규 시트의 AB열은 unisex_score라
  // 옵션 문자열을 쓰면 실 데이터를 오염시킨다 (Session B 리포트 지뢰 1). 검증 원장
  // Stock_Staging의 확인된 숫자만 차감하며(검증일시 불변·비고에 근거 기록), staging 미기입
  // sku는 차감을 보류한다 — 다음 공급처 재검증(cadence)이 값을 다시 맞춘다.
  const decrement = await decrementStagingStock(gateLines, orderId);
  console.log(
    `[stock-decrement] ${orderId} — staging 차감: [${decrement.decremented.join(", ") || "없음"}] 보류: [${decrement.skipped.join(", ") || "없음"}]`,
  );

  // ── 7. 디렉터 텔레그램 알림 ──
  const itemsDesc = resolved.map((r) => `${r.sku}(${r.color}${r.size ? " " + r.size : ""})x${r.qty}`).join(", ");
  await notifyNewOrder(orderId, customer.name, total, shipType, itemsDesc);

  // ── 8. 고객 응답 (입금 안내 포함) ──
  return {
    duplicate: false,
    payload: {
      ok: true,
      order_id: orderId,
      customer_id: customerId,
      payment_method: DEFAULT_PAYMENT_METHOD,
      status: "PAYMENT_PENDING", // canonical (lib/orderState) — 생성 직후 유일한 합법 상태
      status_label: displayLabel("PAYMENT_PENDING"),
      total_amount: total,
      shipping: {
        type: shipType,
        notice: shipType === "분리배송"
          ? "고객님의 주문 상품은 신속한 출고를 위해 각각 개별 포장되어 순차 발송됩니다."
          : undefined,
      },
      deposit_info: {
        ...DEPOSIT_ACCOUNT,
        amount: total,
        depositor: customer.depositor || customer.name,
      },
    },
  };
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
    // [SESSION L · TASK 29] 계약 오류(400/409)는 그대로, 나머지는 고정 문구 + 502 —
    // 내부 예외 원문(Google 오류·JSON 파서 메시지)은 고객에게 보내지 않는다.
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
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
