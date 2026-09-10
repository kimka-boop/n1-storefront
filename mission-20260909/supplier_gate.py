#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 SUPPLIER GATE — 발행 하드 게이트 (Corrective Directive §6)

선별·발행 경로는 이 게이트를 통과한 후보만 담을 수 있다. Markdown 정책이 아니라
실행 코드다. 사용:
  from supplier_gate import assert_publishable, evaluate
  assert_publishable(candidate)            # 미통과 시 SupplierGateError
  verdicts = evaluate_all(candidates)      # 일괄 판정 (QUALIFIED/REJECTED/UNVERIFIED)

게이트 절대 조건 (전부 TRUE여야 통과 — 하나라도 아니면 기각):
  dropship_supported == TRUE
  AND single_unit_order_supported == TRUE
  AND end_customer_direct_shipping == TRUE
  AND supplier_operational_confidence >= threshold (env N1_SUPPLIER_CONFIDENCE_THRESHOLD, 기본 0.80)

증거 계약: 각 필드는 evidence_url + verified_at을 요구한다. 증거 없는 TRUE는 인정하지
않는다(UNVERIFIED로 강등 — 추론 금지). 채널 정규화: DOMEGGOOK_BULK는 기본 부적격(§5 —
대량/선구매 목록), DOMEMAE_DROPSHIP·OWNERCLAN_DROPSHIP 등 배송대행 채널만 게이트 대상.
플랫폼명(supplier_platform=도매꾹)만으로 드롭십 적격을 주장하는 것을 금지한다(§2).
"""
import json
import os
import sys
from datetime import datetime, timezone

CONFIDENCE_THRESHOLD = float(os.environ.get("N1_SUPPLIER_CONFIDENCE_THRESHOLD", "0.80"))

# §5 — 채널 정규화. 같은 회사라도 이행 채널이 다르면 하나의 라벨로 뭉개지 않는다.
CHANNELS = {
    "DOMEGGOOK_BULK": {"kind": "BULK", "default_eligible": False},
    "DOMEMAE_DROPSHIP": {"kind": "DROPSHIP_AGENCY", "default_eligible": None},  # 상품별 검증 필요
    "OWNERCLAN_DROPSHIP": {"kind": "DROPSHIP_AGENCY", "default_eligible": None},
    "UNKNOWN": {"kind": "UNKNOWN", "default_eligible": False},
}


class SupplierGateError(Exception):
    """발행 게이트 미통과 — 후보는 publish-ready 집합에 들어갈 수 없다."""


def _norm(v):
    return str(v or "").strip().upper()


def _evidence_ok(rec, field):
    ev_url = str(rec.get(f"{field}_evidence_url") or rec.get("evidence_url") or "").strip()
    verified_at = str(rec.get(f"{field}_verified_at") or rec.get("verified_at") or "").strip()
    return bool(ev_url) and bool(verified_at)


def evaluate(candidate):
    """단일 후보 판정 → verdict dict. 절대 TRUE 미달·증거 부재는 전부 기록한다(추측 금지)."""
    pid = str(candidate.get("product_id") or candidate.get("상품ID") or "?")
    channel = _norm(candidate.get("supplier_channel") or "UNKNOWN")
    ch = CHANNELS.get(channel, CHANNELS["UNKNOWN"])
    checks = {}
    reasons = []

    # 0. 채널 기본 적격성 — BULK/UNKNOWN 채널은 기각 (§5)
    checks["channel_eligible"] = ch["default_eligible"] is not False
    if not checks["channel_eligible"]:
        reasons.append(f"channel {channel} not dropship-eligible by default")

    for field in ("dropship_supported", "single_unit_order_supported", "end_customer_direct_shipping"):
        val = _norm(candidate.get(field))
        ok = val == "TRUE" and _evidence_ok(candidate, field)
        checks[field] = ok
        if val != "TRUE":
            reasons.append(f"{field}={val or 'EMPTY'} != TRUE")
        elif not ok:
            reasons.append(f"{field}=TRUE but evidence missing")

    tracking = candidate.get("tracking_readable")
    if tracking is not None and _norm(tracking) == "FALSE":
        checks["tracking_readable"] = False
        reasons.append("tracking_readable=FALSE")
    else:
        checks["tracking_readable"] = _norm(tracking) == "TRUE"  # 미검증은 게이트 통과에 불충분

    conf = candidate.get("supplier_operational_confidence")
    try:
        conf_f = float(conf)
    except (TypeError, ValueError):
        conf_f = 0.0
    checks["confidence_threshold"] = conf_f >= CONFIDENCE_THRESHOLD
    if not checks["confidence_threshold"]:
        reasons.append(f"confidence {conf_f:.2f} < {CONFIDENCE_THRESHOLD:.2f}")

    hard_fields_ok = all(
        checks[f] for f in ("channel_eligible", "dropship_supported", "single_unit_order_supported",
                            "end_customer_direct_shipping", "confidence_threshold")
    )
    if hard_fields_ok and checks["tracking_readable"]:
        verdict = "QUALIFIED"
    elif any(_norm(candidate.get(f)) == "FALSE" for f in
             ("dropship_supported", "single_unit_order_supported", "end_customer_direct_shipping")):
        verdict = "REJECTED"
    else:
        # 증거 없는 미확정 — 발행 후보 집합에서 제거된다 (§8)
        verdict = "UNVERIFIED"
    return {
        "product_id": pid,
        "supplier_platform": candidate.get("supplier_platform") or candidate.get("공급사명") or "",
        "supplier_channel": channel,
        "checks": checks,
        "confidence": conf_f,
        "verdict": verdict,
        "reasons": reasons,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }


def assert_publishable(candidate):
    v = evaluate(candidate)
    if v["verdict"] != "QUALIFIED":
        raise SupplierGateError(f"{v['product_id']}: {v['verdict']} — {'; '.join(v['reasons'])}")
    return v


def evaluate_all(candidates):
    return [evaluate(c) for c in candidates]


def summary(verdicts):
    out = {"QUALIFIED": 0, "REJECTED": 0, "UNVERIFIED": 0}
    for v in verdicts:
        out[v["verdict"]] += 1
    return out


if __name__ == "__main__":
    data = json.load(sys.stdin)
    cands = data.get("candidates", data if isinstance(data, list) else [])
    verdicts = evaluate_all(cands)
    json.dump({"summary": summary(verdicts), "verdicts": verdicts}, sys.stdout,
              ensure_ascii=False, indent=1)
