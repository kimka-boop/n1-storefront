/**
 * N°1 RETURN POLICY & ELIGIBILITY (미션 §26·§27·§37)
 *
 * - 반품 가능 시계는 delivered_at 기반. 정책 상수는 여기 하나 (프론트 산개 금지).
 * - 자격 판정은 결정적 비즈니스 로직. LLM은 자연어 사유 해석만 담당하고
 *   법적 자격을 발명하지 않는다 (§37).
 * - 고객 사유는 원문(raw) 보존이 1차, 구조화는 2차다 (§38 — 미진술 주장을
 *   객관 사실로 승격 금지).
 */
import { RETURN_WINDOW_DAYS } from "@/lib/businessRules";
import type { OrderRecord } from "@/lib/sheets";
import { toCanonicalStatus } from "@/lib/orderState";

export interface ReturnWindow {
  /** delivered_at ISO — 미도착은 null */
  deliveredAt: string | null;
  returnEligibilityStart: string | null;
  returnDeadline: string | null;
  /** 컨텍스트 노출용 (§27): "반품 신청 가능 기간 YYYY.MM.DD까지" | "반품 가능 기간 종료" | null */
  windowLabel: string | null;
  expired: boolean;
}

function parseIso(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 도착 기록(도착시각 컬럼)에서 반품 시계를 산출한다. 정책은 RETURN_WINDOW_DAYS 단일 상수. */
export function returnWindowOf(deliveredAtRaw: string, now: Date = new Date()): ReturnWindow {
  const deliveredAt = parseIso(deliveredAtRaw);
  if (!deliveredAt) {
    return { deliveredAt: null, returnEligibilityStart: null, returnDeadline: null, windowLabel: null, expired: false };
  }
  const start = deliveredAt;
  const deadline = new Date(start.getTime() + RETURN_WINDOW_DAYS * 86400000);
  const expired = now.getTime() > deadline.getTime();
  const y = deadline.getFullYear();
  const m = String(deadline.getMonth() + 1).padStart(2, "0");
  const d = String(deadline.getDate()).padStart(2, "0");
  return {
    deliveredAt: deliveredAt.toISOString(),
    returnEligibilityStart: start.toISOString(),
    returnDeadline: deadline.toISOString(),
    windowLabel: expired ? "반품 가능 기간 종료" : `반품 신청 가능 기간 ${y}.${m}.${d}까지`,
    expired,
  };
}

export type ReturnEligibilityOutcome =
  | "ELIGIBLE_FOR_REVIEW"
  | "LIKELY_ELIGIBLE"
  | "MANUAL_REVIEW_REQUIRED"
  | "WINDOW_EXPIRED"
  | "NOT_DELIVERED"
  | "ALREADY_RETURNING"
  | "ALREADY_REFUNDED";

export interface ReturnEligibilityInput {
  order: OrderRecord;
  /** 기존 반품 접수 유무 (Return_Requests 조회 결과) */
  existingReturnRequest?: boolean;
  existingRefunded?: boolean;
  now?: Date;
}

export interface ReturnEligibilityVerdict {
  outcome: ReturnEligibilityOutcome;
  /** 고객에게 보여줄 정직한 상태 문구 */
  message: string;
  window: ReturnWindow;
}

/**
 * §37 결정 자격 엔진 — 상태·시계·기존 접수만으로 판정한다.
 * 사유(product class/customer reason)에 따른 예외는 MANUAL_REVIEW_REQUIRED로만
 * 표현되고, 코드가 자격을 만들어내지 않는다.
 */
export function evaluateReturnEligibility(input: ReturnEligibilityInput): ReturnEligibilityVerdict {
  const { order, existingReturnRequest = false, existingRefunded = false, now = new Date() } = input;
  const status = toCanonicalStatus(order);
  const deliveredRaw = String(order.raw?.["도착시각"] || "");
  const window = returnWindowOf(deliveredRaw, now);

  if (existingRefunded || status === "REFUNDED") {
    return { outcome: "ALREADY_REFUNDED", message: "이미 환불이 완료된 주문입니다.", window };
  }
  if (existingReturnRequest || status === "RETURN_REQUESTED" || status === "REFUND_PENDING") {
    return { outcome: "ALREADY_RETURNING", message: "이미 반품·환불 접수가 진행 중인 주문입니다.", window };
  }
  if (status === "DELIVERED") {
    if (!window.deliveredAt) {
      // 도착 상태인데 도착 기록이 없다 — 수동 확인 (기록을 지어내지 않는다)
      return { outcome: "MANUAL_REVIEW_REQUIRED", message: "도착 기록을 확인 중입니다 — 상담원이 확인 후 안내드릴게요.", window };
    }
    if (window.expired) {
      return { outcome: "WINDOW_EXPIRED", message: window.windowLabel || "반품 가능 기간이 지났어요.", window };
    }
    return { outcome: "LIKELY_ELIGIBLE", message: "반품 접수가 가능한 상태예요.", window };
  }
  if (status === "SHIPPED") {
    // 배송중 — 반품/중단( interception ) 경계. 자동 승인 대상이 아니다.
    return { outcome: "MANUAL_REVIEW_REQUIRED", message: "배송 중인 주문이에요 — 반품·중단 요청은 상담원 확인 후 진행됩니다.", window };
  }
  // 도착 전 (DRAFT/PAYMENT_PENDING/PAID/PREPARING) — 반품이 아니라 취소 검토 대상 (§39)
  return { outcome: "NOT_DELIVERED", message: "아직 배송이 시작되지 않았어요 — 이 주문은 취소 검토 대상입니다.", window };
}

// ── §38 고객 사유 구조화 — 원문 보존 1차 ──────────────────────────────────────

export interface StructuredReason {
  reason_code: "SIZE_MISMATCH_SIMPLE_CHANGE" | "CHANGE_OF_MIND" | "DEFECT" | "NOT_AS_DESCRIBED" | "WRONG_ITEM" | "OTHER";
  opened: "YES" | "NO" | "UNKNOWN";
  used: "YES" | "NO_REPORTED" | "UNKNOWN";
  damage: "YES_REPORTED" | "NO_REPORTED" | "UNKNOWN";
}

/** 고객 문장에서 정직하게 코드만 뽑는다. 미언급은 전부 UNKNOWN/NO_REPORTED — 사실화 금지. */
export function structureReturnReason(raw: string): StructuredReason {
  const t = (raw || "").trim();
  const lower = t.toLowerCase();
  let code: StructuredReason["reason_code"] = "OTHER";
  if (/(사이즈|작아|커|맞지|안\s*맞|타이트)/.test(t)) code = "SIZE_MISMATCH_SIMPLE_CHANGE";
  else if (/(마음|변심|생각|다시|괜찮)/.test(t)) code = "CHANGE_OF_MIND";
  else if (/(하자|불량|찢어|깨짐|오염|눌림|떨어)/.test(t)) code = "DEFECT";
  else if (/(다른|상이|설명|사진과|화면과)/.test(t)) code = "NOT_AS_DESCRIBED";
  else if (/(잘못\s*보내|다른\s*상품|오배송)/.test(t)) code = "WRONG_ITEM";

  const opened: StructuredReason["opened"] =
    /(뜯|개봉|택)/.test(t) ? (/(안\s*뜯|택만|개봉\s*안|몸에\s*대보)/.test(t) ? "NO" : "YES") : "UNKNOWN";
  return {
    reason_code: code,
    opened,
    used: /(입고|착용|세탁|향수)/.test(t) || /(입고|착용|세탁)/.test(lower) ? "YES" : opened === "YES" ? "UNKNOWN" : "NO_REPORTED",
    damage: /(하자|불량|찢어|깨짐|오염)/.test(t) ? "YES_REPORTED" : "NO_REPORTED",
  };
}
