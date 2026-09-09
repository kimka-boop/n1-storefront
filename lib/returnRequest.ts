/**
 * N°1 Return / Exchange Request — Session I (Tasks 16·17)
 *
 * 원칙 (미션 §5·세션 지시):
 * - C의 order state machine(lib/orderState)을 그대로 재사용한다 — 새 중복 상태 체계 금지.
 *   요청 가능 판정 = canTransition(현재상태, "RETURN_REQUESTED") 하나뿐이다.
 * - 자동 refund 승인 금지. 이 모듈이 하는 일은 "요청 접수(reception)"뿐이며
 *   REFUND_PENDING/REFUNDED 로의 전이는 Human/Ops(HERMES)가 Orders 시트에서 수행한다.
 * - Orders 시트 write는 HERMES authority — 이 플로우의 영구 기록은 app 소유
 *   Return_Requests 시트(접수 원장)에만 남는다. Orders 시트는 읽기(readOrderStatus)만 한다.
 * - 게스트/회원 소유 검증은 C의 계약(lib/orderView)을 재사용한다:
 *   회원 = 세션 이메일 ↔ 주문 고객이메일 일치, 게스트 = 연락처 숫자 완전 일치.
 *   소유 불일치·미존재는 구분 없는 generic 응답(PII 0 — lookup 계약과 동일).
 */
import {
  canTransition,
  displayLabel,
  OrderStatus,
  readOrderStatus,
} from "@/lib/orderState";
import {
  OwnerOrderItem,
  parseOrderItems,
  verifyGuestOwnership,
} from "@/lib/orderView";

// ── 유형·사유 ──

export type RequestType = "return" | "exchange";

export interface ReasonOption {
  code: string;
  label: string;
}

/** 반품 사유 — CS 정책 안내(lib/cs POLICY_RETURN)와 정합 */
export const RETURN_REASONS: readonly ReasonOption[] = [
  { code: "SIZE", label: "사이즈가 맞지 않음" },
  { code: "CHANGE_OF_MIND", label: "단순 변심" },
  { code: "DEFECT", label: "상품 불량·파손" },
  { code: "NOT_AS_DESCRIBED", label: "상품이 설명과 다름" },
  { code: "WRONG_ITEM", label: "오배송 (다른 상품이 배송됨)" },
];

/** 교환 사유 — CS 정책 안내(lib/cs POLICY_EXCHANGE)와 정합 */
export const EXCHANGE_REASONS: readonly ReasonOption[] = [
  { code: "SIZE", label: "사이즈 교환" },
  { code: "COLOR", label: "색상 교환" },
  { code: "DEFECT", label: "불량·파손 상품 교환" },
  { code: "WRONG_ITEM", label: "오배송 상품 교환" },
];

export function reasonsFor(type: RequestType): readonly ReasonOption[] {
  return type === "exchange" ? EXCHANGE_REASONS : RETURN_REASONS;
}

export function reasonLabel(type: RequestType, code: string): string | null {
  const hit = reasonsFor(type).find((r) => r.code === code);
  return hit ? hit.label : null;
}

export function typeLabel(type: RequestType): string {
  return type === "exchange" ? "교환" : "반품";
}

// ── 요청 가능 판정 — C 상태머신 재사용 (신규 상태 체계 없음) ──

/**
 * 반품·교환 요청 가능 = canonical 전이 테이블에서 RETURN_REQUESTED 로 갈 수 있는 상태.
 * C의 테이블상 SHIPPED, DELIVERED 둘뿐이다. 이 판정은 lib/orderState 가 유일한 근거다.
 */
export function canRequestReturnExchange(status: OrderStatus): boolean {
  return canTransition(status, "RETURN_REQUESTED");
}

export interface Eligibility {
  ok: boolean;
  message: string; // ok:false 일 때 truthful 안내 사유
}

export function requestEligibility(status: OrderStatus): Eligibility {
  if (canRequestReturnExchange(status)) return { ok: true, message: "" };
  if (status === "RETURN_REQUESTED") {
    return {
      ok: false,
      message: "이미 반품·교환 요청이 접수되어 있습니다 — 검토 결과는 주문 상태에서 확인할 수 있습니다.",
    };
  }
  if (status === "REFUND_PENDING") return { ok: false, message: "환불이 처리 중인 주문입니다." };
  if (status === "REFUNDED") return { ok: false, message: "환불이 완료된 주문입니다." };
  if (status === "CANCEL_REQUESTED" || status === "CANCELLED") {
    return { ok: false, message: "취소가 진행·완료된 주문은 반품·교환 대상이 아닙니다." };
  }
  // PAYMENT_PENDING / PAID / PREPARING / DRAFT — 배송 개시 전
  return {
    ok: false,
    message: "상품 배송이 시작된 뒤 반품·교환을 요청할 수 있습니다. 배송 전에는 고객센터(페이지 하단 좌측)로 문의해 주세요.",
  };
}

// ── 소유 검증 (회원/게스트 — C 계약 재사용) ──

export type RequesterKind = "member" | "guest";

export interface RequesterInput {
  token?: string;
  phone?: string;
}

export interface OrderOwnership {
  orderEmail: string; // Orders.고객이메일 (회원 주문만 값이 있음)
  orderPhone: string; // Orders.연락처
}

/**
 * 토큰이 제시되면 회원 경로로만 판정한다(이메일 불일치 → 게스트 폴백 없음 —
 * 다른 계정으로 타인 주문을 여는 우회를 만들지 않는다).
 * 토큰이 없으면 게스트 경로 — 연락처 숫자 정규화 완전 일치(verifyGuestOwnership).
 */
export function verifyRequestOwnership(
  input: RequesterInput,
  order: OrderOwnership,
  findSession: (token: string) => string | undefined,
): RequesterKind | null {
  const token = (input.token || "").trim();
  if (token) {
    const email = (findSession(token) || "").trim().toLowerCase();
    const orderEmail = (order.orderEmail || "").trim().toLowerCase();
    if (!email || !orderEmail || email !== orderEmail) return null;
    return "member";
  }
  const phone = (input.phone || "").trim();
  if (phone && verifyGuestOwnership({ customerPhone: order.orderPhone }, phone)) {
    return "guest";
  }
  return null;
}

// ── 요청 상품 검증 — 주문 항목 안에서만 ──

export interface RequestItemInput {
  sku?: string;
  color?: string;
  size?: string;
  qty?: number;
}

export interface RequestLine {
  sku: string;
  name: string;
  color: string;
  size: string;
  qty: number;
}

export type ItemsValidation =
  | { ok: true; lines: RequestLine[] }
  | { ok: false; error: string };

function sameLine(a: { sku: string; color: string; size: string }, b: OwnerOrderItem): boolean {
  const norm = (s: string) => (s || "").replace(/\s+/g, "");
  return norm(a.sku) === norm(b.sku) && norm(a.color) === norm(b.color) && norm(a.size) === norm(b.size);
}

export function validateRequestItems(
  requested: RequestItemInput[],
  orderItemsJson: string,
): ItemsValidation {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, error: "반품·교환할 상품을 선택해 주세요" };
  }
  const { items: orderItems, corrupt } = parseOrderItems(orderItemsJson);
  if (corrupt) {
    return { ok: false, error: "주문 상품 정보를 확인할 수 없습니다 — 고객센터로 문의해 주세요" };
  }
  const lines: RequestLine[] = [];
  for (const r of requested) {
    const sku = (r.sku || "").trim();
    const color = (r.color || "").trim();
    const size = (r.size || "").trim();
    const qty = Number(r.qty);
    if (!sku) return { ok: false, error: "상품 선택이 올바르지 않습니다" };
    if (!Number.isInteger(qty) || qty < 1) {
      return { ok: false, error: "수량을 확인해 주세요 (1개 이상)" };
    }
    const match = orderItems.find((o) => sameLine({ sku, color, size }, o));
    if (!match) {
      return { ok: false, error: "주문에 없는 상품이 포함되어 있습니다 — 선택을 다시 확인해 주세요" };
    }
    if (qty > match.qty) {
      return { ok: false, error: `주문 수량(${match.qty}개)을 초과할 수 없습니다 — ${match.name || sku}` };
    }
    lines.push({ sku, name: match.name, color, size, qty });
  }
  return { ok: true, lines };
}

// ── 메모 정리 ──

export const NOTE_MAX = 500;

export function sanitizeNote(note?: string): string {
  return (note || "").trim().slice(0, NOTE_MAX);
}

// ── 접수 원장(Return_Requests) row 계약 — app 소유 시트, Orders 무관 ──

export const RETURN_REQUESTS_SHEET = "Return_Requests";

export const RETURN_REQUEST_HEADERS = [
  "request_id",
  "요청일시",
  "주문번호",
  "고객ID",
  "접수경로", // 회원 | 게스트
  "유형", // 반품 | 교환
  "사유코드",
  "사유",
  "메모",
  "상품", // JSON [{sku,name,color,size,qty}]
  "주문상태(접수시)", // canonical — Ops 판정 전후 대비 스냅샷
  "상태", // "접수됨" — 이후 상태(검토/승인/반려)는 Ops/HERMES가 기록
] as const;

/** 요청 상태는 app이 "접수됨"까지만 쓴다 — 승인·반려는 Ops 판정(Org의 Orders 시트 기록)과 분리 */
export const REQUEST_RECEIVED = "접수됨";

/** 요청 ID — genCustomerId(lib/sheets)와 동일 패턴: 시간 + crypto.randomUUID */
export function genRequestId(now: Date): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `RET-${d}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export interface BuildRowInput {
  now: Date;
  orderId: string;
  customerId: string;
  channel: RequesterKind;
  type: RequestType;
  reasonCode: string;
  reasonLabelText: string;
  note: string;
  lines: RequestLine[];
  orderStatusAtRequest: OrderStatus;
}

export function buildReturnRequestRow(input: BuildRowInput): Record<string, string> {
  return {
    request_id: genRequestId(input.now),
    "요청일시": input.now.toISOString(),
    "주문번호": input.orderId,
    "고객ID": input.customerId,
    "접수경로": input.channel === "member" ? "회원" : "게스트",
    "유형": typeLabel(input.type),
    "사유코드": input.reasonCode,
    "사유": input.reasonLabelText,
    "메모": input.note,
    "상품": JSON.stringify(input.lines),
    "주문상태(접수시)": input.orderStatusAtRequest,
    "상태": REQUEST_RECEIVED,
  };
}

// ── 접수 기록 뷰 (요청 상태 표시) ──

export interface ReturnRequestView {
  request_id: string;
  requested_at: string;
  order_id: string;
  type: RequestType | string;
  type_label: string;
  reason: string;
  note: string;
  items: RequestLine[];
  channel: string; // 회원 | 게스트
  status: string; // 접수됨 (Ops가 기록하면 그 값 그대로)
}

export function projectRequestRow(row: Record<string, string>): ReturnRequestView {
  let items: RequestLine[] = [];
  try {
    const parsed = JSON.parse(row["상품"] || "[]");
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }
  return {
    request_id: row.request_id || "",
    requested_at: row["요청일시"] || "",
    order_id: row["주문번호"] || "",
    type: row["유형"] === "교환" ? "exchange" : "return",
    type_label: row["유형"] || "",
    reason: row["사유"] || "",
    note: row["메모"] || "",
    items,
    channel: row["접수경로"] || "",
    status: row["상태"] || "",
  };
}

// ── 접수 오케스트레이션 — 의존성 주입(순수 검증 가능). Orders 시트엔 쓰지 않는다 ──

export interface ReturnSubmitDeps {
  findOrder: (orderId: string) => Promise<{
    itemsJson: string;
    paymentStatus: string;
    shipStatus: string;
    csMemo: string;
    customerId: string;
    customerPhone: string;
    orderEmail: string;
  } | null>;
  findSession: (token: string) => string | undefined;
  appendRequest: (row: Record<string, string>) => Promise<boolean>;
  notifyOps?: (message: string) => Promise<{ ok: boolean }>;
  now?: () => Date;
}

export interface ReturnSubmitInput extends RequesterInput {
  order_id?: string;
  type?: string;
  reason_code?: string;
  note?: string;
  items?: RequestItemInput[];
}

export type ReturnSubmitResult =
  | {
      ok: true;
      request_id: string;
      message: string;
      request: ReturnRequestView;
    }
  | { ok: false; status: number; error: string };

/** 소유 불일치·미존재 공용 응답 — 존재 유출 없음 (lookup 계약 동일) */
function genericNotFound(): ReturnSubmitResult {
  return {
    ok: false,
    status: 404,
    error: "주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다",
  };
}

export const RECEIPT_MESSAGE =
  "요청이 접수되었습니다. 확인 후 고객센터에서 안내드립니다 — 주문 상태에서 진행 상황을 보실 수 있습니다.";

/**
 * 반품·교환 요청 접수.
 * 하는 일: 소유 검증 → 상태머신 판정(C) → 상품 검증 → Return_Requests 1행 append (+Ops 알림 best-effort).
 * 하지 않는 일: Orders 시트 기록, 주문 상태 전이, 환불 승인 — 전부 Human/Ops(HERMES) 영역.
 */
export async function submitReturnRequest(
  deps: ReturnSubmitDeps,
  input: ReturnSubmitInput,
): Promise<ReturnSubmitResult> {
  const type = input.type === "exchange" ? "exchange" : input.type === "return" ? "return" : null;
  if (!type) {
    return { ok: false, status: 400, error: "요청 유형(반품/교환)을 선택해 주세요" };
  }
  const reasonCode = (input.reason_code || "").trim();
  const labelText = reasonLabel(type, reasonCode);
  if (!labelText) {
    return { ok: false, status: 400, error: "요청 사유를 선택해 주세요" };
  }
  const orderId = (input.order_id || "").trim();
  if (!orderId) {
    return { ok: false, status: 400, error: "주문번호가 필요합니다" };
  }

  const order = await deps.findOrder(orderId);
  if (!order) return genericNotFound();

  const channel = verifyRequestOwnership(
    { token: input.token, phone: input.phone },
    { orderEmail: order.orderEmail, orderPhone: order.customerPhone },
    deps.findSession,
  );
  if (!channel) return genericNotFound();

  // C 상태머신 판독·판정 — 세션·Ops 기록(CS메모 반품요청 태그 포함)이 이미 반영된 값
  const status = readOrderStatus({
    paymentStatus: order.paymentStatus,
    shipStatus: order.shipStatus,
    csMemo: order.csMemo,
  });
  const eligibility = requestEligibility(status);
  if (!eligibility.ok) {
    return { ok: false, status: 409, error: eligibility.message };
  }

  const validation = validateRequestItems(input.items || [], order.itemsJson);
  // strict:false 프로젝트에서는 !ok truthiness 좁혀짐이 동작하지 않는다 — 리터러 비교로 판별
  if (validation.ok === false) {
    return { ok: false, status: 400, error: validation.error };
  }

  const now = (deps.now ? deps.now() : new Date());
  const row = buildReturnRequestRow({
    now,
    orderId,
    customerId: order.customerId,
    channel,
    type,
    reasonCode,
    reasonLabelText: labelText,
    note: sanitizeNote(input.note),
    lines: validation.lines,
    orderStatusAtRequest: status,
  });

  const persisted = await deps.appendRequest(row);
  if (!persisted) {
    return {
      ok: false,
      status: 500,
      error: "요청 접수 기록에 실패했습니다 — 잠시 후 다시 시도해 주세요",
    };
  }

  // Ops 알림은 best-effort — 실패해도 접수 사실(Return_Requests)은 유효
  if (deps.notifyOps) {
    try {
      const linesDesc = validation.lines
        .map((l) => `${l.sku}(${l.color}${l.size ? " " + l.size : ""})x${l.qty}`)
        .join(", ");
      await deps.notifyOps(
        `↩️ N°1 ${typeLabel(type)} 요청 접수\n\n주문번호: ${orderId}\n경로: ${channel === "member" ? "회원" : "게스트"}\n상품: ${linesDesc}\n사유: ${labelText}\n→ Return_Requests 시트에서 확인 후 처리해주세요`,
      );
    } catch {
      // 알림 실패는 접수를 되돌리지 않는다
    }
  }

  return {
    ok: true,
    request_id: row.request_id,
    message: RECEIPT_MESSAGE,
    request: projectRequestRow(row),
  };
}

/** 요청 상태 화면용 — 현재 주문 상태(canonical·Ops 판정 반영) 라벨 */
export function currentOrderStatusLabel(order: {
  paymentStatus: string;
  shipStatus: string;
  csMemo: string;
}): { status: OrderStatus; label: string } {
  const status = readOrderStatus(order);
  return { status, label: displayLabel(status) };
}
