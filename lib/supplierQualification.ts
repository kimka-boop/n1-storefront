/**
 * N°1 SUPPLIER QUALIFICATION — TS 게이트 계약 (Corrective Directive §2·§3·§6)
 *
 * supplier_gate.py(mission-20260909)와 동일 판정을 스토어프론트 계약으로 미러링한다.
 * - 플랫폼명(공급사명=도매꾹)은 드롭십 적격의 증거가 아니다 (§2).
 * - 상품(product-level) 단위 증거만 인정: 각 TRUE에는 evidence_url + verified_at이 필요 (§3).
 * - 채널 정규화: DOMEGGOOK_BULK는 기본 부적격 — DOMEMAE_DROPSHIP 등 배송대행 채널과 구별 (§5).
 * - 판정은 스토어프론트 발행/승격 경로에서 assertPublishable()로 강제된다.
 */

export type SupplierChannel =
  | "DOMEGGOOK_BULK"
  | "DOMEMAE_DROPSHIP"
  | "OWNERCLAN_DROPSHIP"
  | "UNKNOWN";

export interface ProductQualification {
  product_id: string;
  supplier_platform: string;
  supplier_channel: SupplierChannel;
  dropship_supported: "TRUE" | "FALSE" | "UNKNOWN";
  single_unit_order_supported: "TRUE" | "FALSE" | "UNKNOWN";
  end_customer_direct_shipping: "TRUE" | "FALSE" | "UNKNOWN";
  tracking_readable?: "TRUE" | "FALSE" | "UNKNOWN";
  supplier_operational_confidence: number;
  /** §3 — 상품 단위 증거. TRUE의 필수 동반 */
  evidence_url?: string;
  evidence_url_dropship?: string;
  evidence_url_single_unit?: string;
  evidence_url_direct_shipping?: string;
  verified_at?: string;
}

export type QualificationVerdict = "QUALIFIED" | "REJECTED" | "UNVERIFIED";

export const CONFIDENCE_THRESHOLD = Number(process.env.N1_SUPPLIER_CONFIDENCE_THRESHOLD || "0.80");

const CHANNEL_DEFAULT: Record<SupplierChannel, boolean | null> = {
  DOMEGGOOK_BULK: false, // §5 — 대량/선구매 채널은 기본 부적격
  DOMEMAE_DROPSHIP: null, // 상품별 검증 필요
  OWNERCLAN_DROPSHIP: null,
  UNKNOWN: false,
};

export interface QualificationResult {
  product_id: string;
  supplier_channel: SupplierChannel;
  checks: Record<string, boolean>;
  reasons: string[];
  verdict: QualificationVerdict;
  evaluated_at: string;
}

function evidenceOk(q: ProductQualification, field: "dropship_supported" | "single_unit_order_supported" | "end_customer_direct_shipping"): boolean {
  const url = q[`evidence_url_${field}` as const] || q.evidence_url;
  return Boolean(url && q.verified_at);
}

export function evaluateQualification(q: ProductQualification): QualificationResult {
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];
  checks.channel_eligible = CHANNEL_DEFAULT[q.supplier_channel] !== false;
  if (!checks.channel_eligible) reasons.push(`channel ${q.supplier_channel} not dropship-eligible by default`);

  for (const f of ["dropship_supported", "single_unit_order_supported", "end_customer_direct_shipping"] as const) {
    checks[f] = q[f] === "TRUE" && evidenceOk(q, f);
    if (q[f] !== "TRUE") reasons.push(`${f}=${q[f]} != TRUE`);
    else if (!checks[f]) reasons.push(`${f}=TRUE but evidence missing`);
  }
  checks.tracking_readable = q.tracking_readable === "TRUE";
  checks.confidence_threshold = q.supplier_operational_confidence >= CONFIDENCE_THRESHOLD;
  if (!checks.confidence_threshold) {
    reasons.push(`confidence ${q.supplier_operational_confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD.toFixed(2)}`);
  }

  const hard = ["channel_eligible", "dropship_supported", "single_unit_order_supported", "end_customer_direct_shipping", "confidence_threshold"]
    .every((k) => checks[k]);
  const anyFalse = [q.dropship_supported, q.single_unit_order_supported, q.end_customer_direct_shipping]
    .some((v) => v === "FALSE");
  const verdict: QualificationVerdict = hard && checks.tracking_readable ? "QUALIFIED" : anyFalse ? "REJECTED" : "UNVERIFIED";
  return {
    product_id: q.product_id,
    supplier_channel: q.supplier_channel,
    checks,
    reasons,
    verdict,
    evaluated_at: new Date().toISOString(),
  };
}

export class SupplierGateError extends Error {}

/** 발행·승격 경로의 강제점 — QUALIFIED 외 전부 예외 (§6: 코드 강제) */
export function assertPublishable(q: ProductQualification): QualificationResult {
  const r = evaluateQualification(q);
  if (r.verdict !== "QUALIFIED") {
    throw new SupplierGateError(`${r.product_id}: ${r.verdict} — ${r.reasons.join("; ")}`);
  }
  return r;
}
