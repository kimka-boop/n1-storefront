/**
 * N°1 Order View — 주문 읽기 계약 (Session C, 미션 §9·§10)
 *
 * - projectOrderForOwner: 소유권이 검증된 읽기(회원 본인 내역, 게스트 번호+연락처 검증)에만
 *   쓰는 full projection — PII 포함.
 * - verifyGuestOwnership: 게스트 조회 소유 검증 프레디킷. 주문번호만으로는 절대
 *   소유자 뷰를 내주지 않는다(주문번호 유출 = PII 유출 방지).
 * - publicOrderProbe: 주문번호만 있을 때 돌려주는 정보 — 존재 유출조차 하지 않는
 *   generic 응답용 (PII 0).
 */
import { readOrderStatus, displayLabel, OrderStatus } from "@/lib/orderState";

export interface OwnerOrderItem {
  sku: string;
  name: string;
  color: string;
  size: string;
  qty: number;
  unit_price: number;
}

export interface OwnerOrderView {
  order_id: string;
  order_time: string;
  status: OrderStatus;
  status_label: string;
  items: OwnerOrderItem[];
  subtotal: number;
  total: number;
  payment: { method: string; status: string; depositor: string; pg_txn_id?: string };
  shipping: { type: string; status: string; carrier: string; tracking_no: string };
  customer: { name: string; phone: string; address: string; email?: string };
  customer_id: string;
}

export interface OrderRecordInput {
  orderId: string;
  orderTime: string;
  paymentMethod: string;
  paymentStatus: string;
  depositor: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerId: string;
  itemsJson: string;
  total: number;
  shipType: string;
  shipStatus: string;
  carrier: string;
  trackingNo: string;
  csMemo: string;
  raw?: Record<string, string>;
}

/** 시트 주문항목 JSON 파싱 — 손상 시 안전하게 빈 배열 (라인 유실을 조용히 만들지 않기 위해 note 반환) */
export function parseOrderItems(itemsJson: string): { items: OwnerOrderItem[]; corrupt: boolean } {
  if (!itemsJson) return { items: [], corrupt: false };
  try {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) return { items: [], corrupt: true };
    return {
      items: parsed
        .filter((it: unknown): it is Record<string, unknown> => typeof it === "object" && it !== null)
        .map((it) => ({
          sku: String(it.sku ?? ""),
          name: String(it.name ?? it.sku ?? ""),
          color: String(it.color ?? ""),
          size: String(it.size ?? ""),
          qty: Math.max(0, Number(it.qty) || 0),
          unit_price: Math.max(0, Number(it.unit_price) || 0),
        })),
      corrupt: false,
    };
  } catch {
    return { items: [], corrupt: true };
  }
}

function digitsOnly(s: string): string {
  return (s || "").replace(/[^\d]/g, "");
}

/** 소유자 full view — 검증된 읽기(회원 본인 / 게스트 번호+연락처 일치)에만 사용 */
export function projectOrderForOwner(record: OrderRecordInput): OwnerOrderView {
  const { items } = parseOrderItems(record.itemsJson);
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const status = readOrderStatus({
    paymentStatus: record.paymentStatus,
    shipStatus: record.shipStatus,
    csMemo: record.csMemo,
  });
  return {
    order_id: record.orderId,
    order_time: record.orderTime,
    status,
    status_label: displayLabel(status),
    items,
    subtotal,
    total: record.total,
    payment: {
      method: record.paymentMethod,
      status: record.paymentStatus,
      depositor: record.depositor,
      pg_txn_id: record.raw?.["PG거래ID"] || undefined,
    },
    shipping: {
      type: record.shipType,
      status: record.shipStatus,
      carrier: record.carrier,
      tracking_no: record.trackingNo,
    },
    customer: {
      name: record.customerName,
      phone: record.customerPhone,
      address: record.customerAddress,
      email: record.raw?.["고객이메일"] || undefined,
    },
    customer_id: record.customerId,
  };
}

/**
 * 게스트 주문 조회 소유 검증 — 주문번호 + 연락처가 모두 일치할 때만 통과.
 * - 연락처는 정규화(숫자만) 후 완전 일치. 뒷자리 일부만으로는 통과시키지 않는다.
 * - 주문번호만 있는 요청은 이 프레디킷을 통과하지 못하며, 호출자는 존재 여부를
 *   드러내지 않는 generic 404 로 응답해야 한다.
 */
export function verifyGuestOwnership(
  record: Pick<OrderRecordInput, "customerPhone"> | null,
  presentedPhone: string,
): boolean {
  if (!record) return false;
  const owned = digitsOnly(record.customerPhone);
  const presented = digitsOnly(presentedPhone);
  if (!owned || !presented) return false;
  return owned === presented;
}

/** 주문번호만 제시했을 때의 응답 — 정보 0 (존재 유출 없음). 호출자는 이 형태를 그대로 쓴다. */
export function publicOrderProbeRejected(): { ok: false; error: string } {
  return { ok: false, error: "주문번호와 연락처가 일치하는 주문을 찾을 수 없습니다" };
}

/**
 * 입금확인 요청 중복 판정 — CS메모에 이미 이 주문의 요청이 기록됐는지.
 * /api/orders/confirm 이 더블 클릭·콜백 재시도로 메모/알림을 중복 남기지 않게 하는 규칙.
 */
export function confirmMemoAlreadyRequested(memo: string): boolean {
  return (memo || "").includes("입금확인요청");
}
