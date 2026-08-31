/**
 * N°1 — Product Media 표준 (CORE OPERATING SPEC v1.0 + MEDIA POLICY v2.0)
 *
 * 6-slot 규격:
 *   01 AI_MODEL_FRONT     — 모델 정면 풀샷 (AI 생성)
 *   02 AI_MODEL_45DEG     — 모델 45도 샷 (AI 생성)
 *   03 AI_MODEL_90DEG     — 모델 90도 샷 (AI 생성)
 *   04 AI_MODEL_BACK      — 모델 180도 후면 샷 (AI 생성)
 *   05 AI_PRODUCT_CUTOUT  — AI 재생성 제품 단독 이미지
 *                           (도매 원본 다운로드/배경제거만한 이미지 절대 금지)
 *   06 AI_PRODUCT_REEL    — 9:16 제품 소개 릴스 (AI 생성)
 *
 * QA 상태: MEDIA_PENDING | MEDIA_GENERATING | MEDIA_NEEDS_REVIEW |
 *          MEDIA_QA_FAILED | MEDIA_QA_PASS
 * complete = 6슬롯 모두 MEDIA_QA_PASS인 경우만 true.
 */

export const MEDIA_SLOTS = [
  { order: "01", type: "AI_MODEL_FRONT" },
  { order: "02", type: "AI_MODEL_45DEG" },
  { order: "03", type: "AI_MODEL_90DEG" },
  { order: "04", type: "AI_MODEL_BACK" },
  { order: "05", type: "AI_PRODUCT_CUTOUT" },
  { order: "06", type: "AI_PRODUCT_REEL" },
] as const;

export type MediaQaStatus =
  | "MEDIA_PENDING"
  | "MEDIA_GENERATING"
  | "MEDIA_NEEDS_REVIEW"
  | "MEDIA_QA_FAILED"
  | "MEDIA_QA_PASS";

export const MEDIA_QA_STATUSES: MediaQaStatus[] = [
  "MEDIA_PENDING",
  "MEDIA_GENERATING",
  "MEDIA_NEEDS_REVIEW",
  "MEDIA_QA_FAILED",
  "MEDIA_QA_PASS",
];

/** Product Media 시트 1행 → 파싱 */
export interface MediaRow {
  productId: string;
  mediaType: string;
  mediaOrder: string;
  mediaUrl: string;
  qaStatus: MediaQaStatus | string;
  generationModel?: string;
  sourceReference?: string;
  qaNote?: string;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SlotState {
  mediaOrder: string;
  mediaType: string;
  exists: boolean;
  qaStatus: MediaQaStatus | "MISSING";
  mediaUrl?: string;
}

export interface MediaCompleteness {
  slots: SlotState[];
  passCount: number;
  complete: boolean;
  aggregate: "MEDIA_COMPLETE" | "MEDIA_INCOMPLETE";
}

export function parseMediaRows(rows: Record<string, string>[]): MediaRow[] {
  return rows
    .filter((r) => r["product_id"] && r["media_type"])
    .map((r) => ({
      productId: String(r["product_id"] || "").trim(),
      mediaType: String(r["media_type"] || "").trim(),
      mediaOrder: String(r["media_order"] || "").trim(),
      mediaUrl: String(r["media_url"] || "").trim(),
      qaStatus: String(r["qa_status"] || "MEDIA_PENDING").trim(),
      generationModel: r["generation_model"] || "",
      sourceReference: r["source_reference"] || "",
      qaNote: r["qa_note"] || "",
      version: r["version"] || "1",
      createdAt: r["created_at"] || "",
      updatedAt: r["updated_at"] || "",
    }));
}

/** 상품 1개의 미디어 완결성 평가 — 6슬롯 모두 QA_PASS만 complete */
export function evaluateMedia(
  productId: string,
  allMedia: MediaRow[]
): MediaCompleteness {
  const mine = allMedia.filter((m) => m.productId === productId);
  const slots: SlotState[] = MEDIA_SLOTS.map((s) => {
    const norm = (v: string) => String(Number(v || 0)).padStart(2, "0");
    const row = mine.find(
      (m) => m.mediaType === s.type || norm(m.mediaOrder) === s.order
    );
    if (!row) {
      return { mediaOrder: s.order, mediaType: s.type, exists: false, qaStatus: "MISSING" as const };
    }
    return {
      mediaOrder: row.mediaOrder || s.order,
      mediaType: row.mediaType,
      exists: true,
      qaStatus: (MEDIA_QA_STATUSES as string[]).includes(row.qaStatus)
        ? (row.qaStatus as MediaQaStatus)
        : ("MEDIA_PENDING" as MediaQaStatus),
      mediaUrl: row.mediaUrl,
    };
  });
  const passCount = slots.filter((s) => s.qaStatus === "MEDIA_QA_PASS").length;
  const complete = passCount === MEDIA_SLOTS.length;
  return {
    slots,
    passCount,
    complete,
    aggregate: complete ? "MEDIA_COMPLETE" : "MEDIA_INCOMPLETE",
  };
}

// ── 주문/환불 상태머신 (CORE OPERATING SPEC v1.0 PART 3~4) ──

export const ORDER_STATES = [
  "PENDING", "PAID", "PREPARING", "SHIPPED", "DELIVERED", "COMPLETED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const CANCEL_STATES = ["CANCEL_REQUESTED", "CANCELLED"] as const;
export type CancelState = (typeof CANCEL_STATES)[number] | "";

export const RETURN_STATES = [
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_SHIPPING",
  "RETURN_RECEIVED", "REFUND_REQUESTED", "REFUNDED",
] as const;
export type ReturnState = (typeof RETURN_STATES)[number] | "";

export const EXCHANGE_STATES = [
  "EXCHANGE_REQUESTED", "EXCHANGE_APPROVED", "EXCHANGE_SHIPPING",
  "EXCHANGE_RECEIVED", "EXCHANGE_COMPLETED",
] as const;
export type ExchangeState = (typeof EXCHANGE_STATES)[number] | "";

/** 상태 전이 검증 — 허용되지 않는 전이는 거부 */
const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  PENDING: ["PAID", "CANCELLED" as OrderState],
  PAID: ["PREPARING"],
  PREPARING: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return (ORDER_TRANSITIONS[from] || []).includes(to);
}
