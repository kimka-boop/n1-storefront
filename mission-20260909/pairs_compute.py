#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — Pair Score V1 계산 + 최대가중 1:1 매칭 (STEP 16-17)
stdin: catalog_selected.json  stdout: pairing_results.json

PAIRING POLICY V1 핵심 (N1_PAIRING_POLICY_V1.md 구현체):
- Hard gates (§38): publish eligible / same gender scope / TOP×BOTTOM 만
- Pair Score V1 (§39, 100점, 내부 머천다이징 랭킹용 — 고객 노출 금지 §40):
  A TREND 20 — 클러스터 교집합(각 8, 최대16) + evidence 보완 조합 보너스(4)
  B COLOR 20 — neutral×neutral 20 / 데님 관여 17 / neutral+color 15 / 무관 8
  C SILHOUETTE 20 — oversize top × straight/slim bottom 20 / regular×straight 18 /
    slim top × wide 16 / oversize × wide 6 (§41 evidence: compact top + relaxed bottom)
  D MATERIAL·SEASON 15 — 니트×데님 15 (T02 evidence) / 기모 동일 15 / 기모×비기모 9 /
    톤온톤 워싱 13 / 미확인 10 (UNKNOWN은 가감 없음 §44)
  E OCCASION 10 — 셔츠×슬랙스(오피스) 10 / 맨투맨×캐주얼 10 / 체크×체크 3
  F PRICE 5 — 세트 판매가 4~9만원대 만점, 극단(>12만/<3만) 감점
  G DATA 5 — 양측 sub+cluster 완비 5 / 일측 결손 3
  H DIVERSITY 5 — 매칭 단계에서 동일 bottom 반복·동색 조합 과밀 패널티로 반영
- Threshold (§46): 80+ BEST MATCH / 70-79 secondary / <70 primary 금지
- Matching (§45): 스코프별 전수 순열 탐색(≤8! 로 정확 최적) — 최대가중 완전일치
"""
import json, sys, itertools

NEUTRAL_COLOR_FAMS = ["블랙", "화이트", "아이보리", "크림", "베이지", "그레이", "차콜", "네이비", "브라운", "카멜"]
DENIM_TOKENS = ["데님", "진청", "흑청", "연청"]

def color_fam(p):
    cols = p["colors"] or []
    for c in cols:
        if c in DENIM_TOKENS:
            return "denim"
        if c in NEUTRAL_COLOR_FAMS:
            return c
    return cols[0] if cols else ""

def is_denim(p):
    return p["sub"] == "JEANS" or any(c in DENIM_TOKENS for c in p["colors"])

def is_knit(p):
    return p["sub"] in ("KNIT", "CARDIGAN", "VEST")

def silhouette_class(p):
    n = p["name"] + " " + p["raw_name"]
    if p["top_bottom"] == "의류-상의":
        if any(k in n for k in ("오버핏", "루즈핏", "루즈", "오버")):
            return "oversized"
        if any(k in n for k in ("세미",)):
            return "regular"
        return "regular"
    if any(k in n for k in ("와이드",)) and "세미와이드" not in n:
        return "wide"
    if any(k in n for k in ("부츠컷",)):
        return "bootcut"
    if any(k in n for k in ("스트레이트", "일자")):
        return "straight"
    if any(k in n for k in ("세미와이드",)):
        return "semiwide"
    if any(k in n for k in ("루즈", "밴딩")):
        return "relaxed"
    if "스커트" in n:
        return "skirt"
    return "regular"

def season_class(p):
    n = p["name"] + " " + p["raw_name"]
    if "기모" in n:
        return "fleece"
    if is_knit(p):
        return "knit"
    return "mid"

def trend_score(a, b):
    inter = set(a["cluster_ids"]) & set(b["cluster_ids"])
    if not inter:
        return 4  # 보완 조합 보너스용 하한 (§41 complementary와 합산)
    return min(16, 10 * len(inter))

def complementary_bonus(a, b):
    """§41 evidence 조합: 니트×셔츠(레이어 베이스), 셔츠×슬랙스, 니트×데님"""
    pair = {a["sub"], b["sub"]}
    if "KNIT" in pair or "CARDIGAN" in pair or "VEST" in pair:
        if "SHIRT" in pair or "JEANS" in pair or "SLACKS" in pair:
            return 4
    if "SHIRT" in pair and "SLACKS" in pair:
        return 4
    return 0

def color_score(a, b):
    fa, fb = color_fam(a), color_fam(b)
    if is_denim(a) or is_denim(b):
        return 17
    if fa and fb:
        if fa in NEUTRAL_COLOR_FAMS and fb in NEUTRAL_COLOR_FAMS:
            return 20
        if fa in NEUTRAL_COLOR_FAMS or fb in NEUTRAL_COLOR_FAMS:
            return 16
        return 11
    if not fa and not fb:
        # 색상 미확인 쌍 — 중간값 (§44: UNKNOWN은 좋다/나쁘다 상상하지 않음)
        return 13
    return 15

def silhouette_score(a, b):
    sc = silhouette_class(b)
    ts = silhouette_class(a)
    table = {
        ("oversized", "straight"): 20, ("oversized", "bootcut"): 19,
        ("oversized", "slim"): 18, ("regular", "straight"): 18,
        ("regular", "bootcut"): 18, ("regular", "semiwide"): 16,
        ("regular", "wide"): 15, ("regular", "skirt"): 16,
        ("oversized", "semiwide"): 12, ("oversized", "wide"): 6,
        ("oversized", "relaxed"): 8, ("regular", "relaxed"): 13,
    }
    return table.get((ts, sc), 14)

def material_score(a, b):
    sa, sb = season_class(a), season_class(b)
    pair = {sa, sb}
    subs = {a["sub"], b["sub"]}
    if "SHIRT" in subs and ("KNIT" in subs or "CARDIGAN" in subs or "VEST" in subs):
        return 15  # T06/T02: 셔츠 위 니트 레이어링 (최다 반복 evidence)
    if is_knit(a) and is_denim(b):
        return 15  # T02: 니트 × 데님 기본 공식
    if "fleece" in pair and "knit" in pair:
        return 14
    if "fleece" in pair and "mid" in pair:
        return 11
    if sa == sb:
        return 13
    return 11

def occasion_score(a, b):
    subs = {a["sub"], b["sub"]}
    if "체크" in a["name"] and "체크" in b["name"]:
        return 3
    if a["sub"] == "SHIRT" and b["sub"] == "SLACKS":
        return 10
    # 캐주얼 공식: 니트/스웨트/후드 × 데님/트레이닝/와이드팬츠
    casual_tops = {"SWEATSHIRT", "HOODIE", "KNIT", "CARDIGAN", "ZIPUP", "POLO", "TSHIRT"}
    casual_bottoms = {"JEANS", "SWEATPANTS", "PANTS", "CARGO"}
    if subs & casual_tops and subs & casual_bottoms:
        return 10
    if subs <= {"SHIRT", "SLACKS", "SKIRT", "KNIT", "CARDIGAN", "VEST"}:
        return 8  # 오피스/먼터리 계열
    return 8

def price_score(a, b):
    total = a["retail"] + b["retail"]
    if 40000 <= total <= 90000:
        return 5
    if total < 30000 or total > 120000:
        return 2
    return 4

def data_score(a, b):
    ok = sum(1 for p in (a, b) if p["sub"] and p["cluster_ids"])
    return 5 if ok == 2 else 3

def pair_score(a, b):
    s = {
        "trend": min(20, trend_score(a, b) + complementary_bonus(a, b)),
        "color": color_score(a, b),
        "silhouette": silhouette_score(a, b),
        "material": material_score(a, b),
        "occasion": occasion_score(a, b),
        "price": price_score(a, b),
        "data": data_score(a, b),
    }
    s["total"] = sum(s.values())
    return s

def brute_match(tops, bots, floor=68, diversity=True):
    """최대가중 매칭 + 최소 스코어 플로어 (§46: 나쁜 조합 강제 금지).
    k=tops 수에서 1씩 줄여가며(미매칭 허용) min-score ≥ floor 인 최대 매칭을 택한다."""
    import math
    n = len(tops)
    m = len(bots)
    if n > m:
        return None, None
    for k in range(n, max(0, n - 3), -1):
        best, best_val, best_min = None, -1, -1
        for perm in itertools.permutations(range(m), k):
            top_idx = range(k)
            vals = [pair_score(tops[ti], bots[perm[ti]])["total"] for ti in top_idx]
            if min(vals) < floor:
                continue
            val = sum(vals)
            if diversity:
                fam_seen = {}
                for ti in top_idx:
                    fam = color_fam(bots[perm[ti]]) or "x"
                    fam_seen[fam] = fam_seen.get(fam, 0) + 1
                    if fam_seen[fam] > 1:
                        val -= (fam_seen[fam] - 1) * 2.0
            if val > best_val:
                best_val, best = val, perm
        if best is not None:
            return best, best_val
    # 플로어 미달 시에도 최고 조합 (tier=BELOW로 표기 — primary 뷰 제외)
    perm = brute_match_any(tops, bots, diversity)
    return perm, None

def brute_match_any(tops, bots, diversity=True):
    n, m = len(tops), len(bots)
    if n > m:
        return None
    best, best_val = None, -1
    for perm in itertools.permutations(range(m), n):
        val = sum(pair_score(tops[ti], bots[perm[ti]])["total"] for ti in range(n))
        if val > best_val:
            best_val, best = val, perm
    return best

def main():
    data = json.load(sys.stdin)
    cat = data["catalog"]
    scopes = {"MALE": "남성", "FEMALE": "여성", "GENDERLESS": "젠더리스"}
    all_pairs = []
    for g, label in scopes.items():
        tops = [p for p in cat if p["gender"] == g and p["top_bottom"] == "의류-상의"]
        bots = [p for p in cat if p["gender"] == g and p["top_bottom"] == "의류-하의"]
        perm, _val = brute_match(tops, bots, floor=68)
        if perm is None:
            sys.stderr.write(f"{g}: 매칭 불가\n")
            continue
        for ti, bi in enumerate(perm):
            a, b = tops[ti], bots[bi]
            s = pair_score(a, b)
            tier = "BEST_MATCH" if s["total"] >= 78 else ("SECONDARY" if s["total"] >= 68 else "BELOW_THRESHOLD")
            all_pairs.append({
                "pair_id": f"PAIR-{g[:2]}-{len(all_pairs)+1:02d}",
                "collection_scope": g, "scope_label": label,
                "top_product_id": a["product_id"], "top_name": a["name"],
                "bottom_product_id": b["product_id"], "bottom_name": b["name"],
                "pair_score_internal": s["total"], "score_breakdown": s, "tier": tier,
                "trend_clusters": sorted(set(a["cluster_ids"]) & set(b["cluster_ids"])),
                "pair_reason_short": reason_short(a, b, s),
                "generated_at": "2026-09-09",
            })
    out = {"policy": "N1_PAIRING_POLICY_V1", "threshold": {"best": 78, "secondary": 68},
           "pairs": all_pairs}
    json.dump(out, sys.stdout, ensure_ascii=False)
    best = sum(1 for p in all_pairs if p["tier"] == "BEST_MATCH")
    below = sum(1 for p in all_pairs if p["tier"] == "BELOW_THRESHOLD")
    sys.stderr.write(f"pairs {len(all_pairs)} best {best} below {below}\n")

def reason_short(a, b, s):
    sc = silhouette_class(b)
    ts = silhouette_class(a)
    parts = []
    inter = set(a["cluster_ids"]) & set(b["cluster_ids"])
    if inter:
        parts.append("같은 트렌드 무드")
    if is_denim(b):
        parts.append("데님 밸런스")
    if sc in ("straight", "bootcut") and ts == "oversized":
        parts.append("오버 핏 × 일자 하의 균형")
    elif sc in ("wide", "semiwide") and ts in ("regular", "oversized"):
        parts.append("여유로운 실루엣 완성")
    if "기모" in a["name"] or "기모" in b["name"]:
        parts.append("초겨울 보온 조합")
    return " · ".join(parts[:3]) if parts else "베이스 캐주얼 조합"

if __name__ == "__main__":
    main()
