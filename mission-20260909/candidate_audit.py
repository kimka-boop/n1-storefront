#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — 후보 감사·스코어링·선별 (STEP 10-12)
파일 I/O 없음: stdin으로 풀 JSON 수신, stdout으로 감사 JSON 출력.
셸: python candidate_audit.py < sourcing_pool_raw.json > candidate_audit.json

정책 근거 (재사용·확장):
- margin_pct: 판매가 = 도매가 × 1.9 (HERMES n1_md/ai_md.py — Owner 승인 정책)
- 분류: taxonomy_v2.classify 규칙 재사용 + RC 스코프 결정 (가디건/집업/베스트=TOP, 헤비아우터=제외)
- 트렌드 정렬: 이번 미션 TREND CLUSTERS T01-T10 evidence 기반 키워드 매핑
- UNKNOWN ≠ FACT: 상세 미확인 필드는 UNKNOWN 유지
"""
import json, re, sys, difflib

ALLOWED_HOST = "www.domeggook.com"

EXCLUDE_OUTER_KW = ["블루종", "봄버", "항공점퍼", "코트", "더플", "패딩", "점퍼", "바람막이",
                    "윈드브레이커", "자켓", "재킷", "트러커", "슈트", "누빔"]
BOTTOM_KW = [("JEANS", ("청바지", "데님 팬츠", "데님팬츠", "진", "데님")),
             ("SLACKS", ("슬랙스", "정장 바지")),
             ("CARGO", ("카고",)),
             ("SWEATPANTS", ("트레이닝", "츄리닝", "조거")),
             ("SHORTS", ("반바지", "버뮤다", "숏팬츠")),
             ("SKIRT", ("스커트", "치마")),
             ("PANTS", ("팬츠", "바지", "레깅스"))]
TOP_KW = [("TSHIRT", ("티셔츠", "반팔티", "긴팔티")),
          ("SHIRT", ("셔츠", "남방", "블라우스")),
          ("KNIT", ("니트", "스웨터", "털니트")),
          ("SWEATSHIRT", ("맨투맨", "스웨트셔츠", "반집업")),
          ("HOODIE", ("후드", "후디")),
          ("POLO", ("폴로", "카라티", "카라 티")),
          ("CARDIGAN", ("가디건",)),
          ("ZIPUP", ("집업",)),
          ("VEST", ("니트베스트", "니트 베스트", "스웨터베스트", "스웨터 베스트", "베스트"))]

CLUSTERS = {
    "T01": {"name": "슬림·스트레이트 회귀", "confidence": "HIGH",
            "kw": ["스트레이트", "부츠컷", "부츠 컷", "테이퍼드", "슬랙스", "정핏", "세미와이드", "시가렛"]},
    "T02": {"name": "니트 퍼스트 레이어링", "confidence": "HIGH",
            "kw": ["니트", "스웨터", "하프집업", "쿼터집업", "반집업", "브이넥", "브이 넥", "터틀넥", "터틀 넥", "가디건", "베스트", "카디건"]},
    "T04": {"name": "브라운·어스 팔레트 + 버건디 포인트", "confidence": "HIGH",
            "kw": ["브라운", "카멜", "베이지", "올리브", "카키", "버건디", "와인", "초콜릿", "먹색"]},
    "T05": {"name": "워싱·빈티지 파브", "confidence": "HIGH",
            "kw": ["워싱", "와싱", "빈티지", "피그먼트", "페이드", "가공", "오버다이", "블리치"]},
    "T06": {"name": "셔츠 레이어링 레시피", "confidence": "HIGH",
            "kw": ["셔츠", "남방", "옥스포드", "워셔블"]},
    "T07": {"name": "체크 셋업", "confidence": "MEDIUM",
            "kw": ["체크", "체커", "타탄", "플레이드", "호박"]},
    "T08": {"name": "울·플리스 코지", "confidence": "MEDIUM",
            "kw": ["울 블렌드", "기모", "모헤어", "앙고라", "플리스", "스웨이드", "울"]},
    "T09": {"name": "올블랙 텍스처", "confidence": "MEDIUM",
            "kw": ["블랙", "검정", "먹색"]},
    "T10": {"name": "미디 스커트 리바이벌", "confidence": "MEDIUM",
            "kw": ["스커트", "미디", "펜슬", "에이라인", "H라인"]},
}

NEUTRALS = ["블랙", "화이트", "아이보리", "크림", "베이지", "그레이", "차콜", "네이비", "브라운", "카멜"]
NOISE_KW = ["땡처리", "초특가", "사은품", "폰케이스", "양말", "이너팬츠", "속옷", "러닝",
            "키즈", "아동", "유아", "수면", "잠옷", "홈웨어", "요가", "등산", "바디수트", "우주복"]
PRICE_MIN, PRICE_MAX = 4000, 45000

def classify(title):
    n = title
    is_knit_layer = any(k in n for k in ("니트 가디건", "니트베스트", "니트 베스트", "가디건", "베스트"))
    if any(k in n for k in EXCLUDE_OUTER_KW) and not is_knit_layer:
        return "EXCLUDE-OUTER", ""
    if any(k in n for k in ("원피스", "점프수트", "세트", "셋업", "하객")) and "베스트" not in n:
        return "EXCLUDE-SET", ""
    if any(k in n for k in NOISE_KW) or any(k in n for k in ("수면", "이너", "속옷", "모자", "스카프", "가방", "신발", "운동화")):
        return "EXCLUDE-ACC", ""
    bottom_hit = ""
    for sub, kws in BOTTOM_KW:
        if any(k in n for k in kws):
            bottom_hit = sub
            break
    top_hit = ""
    for sub, kws in TOP_KW:
        if any(k in n for k in kws):
            top_hit = sub
            break
    if bottom_hit and top_hit:
        # 상·하의 키워드 혼재 → 제품 주체 불명 (셔츠+슬랙스 혼합 타이틀 등) — 정직하게 제외
        return "EXCLUDE-AMBIGUOUS", ""
    if bottom_hit:
        return "BOTTOM", bottom_hit
    if top_hit:
        return "TOP", top_hit
    return "UNKNOWN", ""

def gender_of(title, kw):
    n = title
    if "남녀공용" in n or "유니섹스" in n:
        return "GENDERLESS"
    if "여성" in n or "여자" in n or "우먼" in n:
        return "FEMALE"
    if "남성" in n or "남자" in n:
        return "MALE"
    if kw.startswith("남성") or kw.startswith("남녀"):
        return "MALE" if kw.startswith("남성") else "GENDERLESS"
    if kw.startswith("여성"):
        return "FEMALE"
    if kw in ("무지 긴팔 티셔츠", "피그먼트 맨투맨", "후드 스웨트셔츠"):
        return "GENDERLESS"
    return "GENDERLESS"

def cluster_hits(title):
    return [cid for cid, meta in CLUSTERS.items() if any(k in title for k in meta["kw"])]

def margin_pct(cost):
    sell = round(cost * 1.9 / 100.0) * 100.0
    return (sell - cost) / sell * 100 if sell else 0.0

def retail_price(cost):
    return int(round(cost * 1.9 / 100.0) * 100.0)

def name_similarity(a, b):
    ta = set(re.findall(r"[가-힣]{2,}", a)); tb = set(re.findall(r"[가-힣]{2,}", b))
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb) / max(len(ta), len(tb))
    return max(inter, difflib.SequenceMatcher(None, a, b).ratio())

def main():
    pool = json.load(sys.stdin)["items"]
    stats = {"pool": len(pool), "classified": 0, "excluded": 0, "price_band": 0}
    seen, cands = set(), []
    for it in pool:
        if it["no"] in seen or not it["title"]:
            continue
        seen.add(it["no"])
        role, sub = classify(it["title"])
        if role.startswith("EXCLUDE") or role == "UNKNOWN":
            stats["excluded"] += 1
            continue
        if any(k in it["title"] for k in NOISE_KW):
            stats["excluded"] += 1
            continue
        cost = it["price"]
        if not (PRICE_MIN <= cost <= PRICE_MAX):
            stats["price_band"] += 1
            continue
        cands.append({
            "no": it["no"], "title": it["title"], "cost": cost,
            "retail": retail_price(cost), "margin_pct": round(margin_pct(cost), 1),
            "url": it["url"] or f"https://{ALLOWED_HOST}/{it['no']}",
            "thumb": it["thumb"],
            "unitQty": it.get("unitQty"),
            "role": role, "sub": sub,
            "gender": gender_of(it["title"], it["kw"]),
            "cluster_ids": cluster_hits(it["title"]),
            "kw": it["kw"],
        })
        stats["classified"] += 1
    groups = []
    for c in sorted(cands, key=lambda x: x["cost"]):
        placed = False
        for g in groups:
            rep = g[0]
            if c["role"] == rep["role"] and c["gender"] == rep["gender"] \
               and name_similarity(c["title"], rep["title"]) >= 0.6:
                g.append(c)
                placed = True
                break
        if not placed:
            groups.append([c])
    ranked = []
    weight = {"HIGH": 20, "MEDIUM": 12}
    for g in groups:
        rep = g[0]
        clusters = sorted({cid for m in g for cid in m["cluster_ids"]})
        trend = sum(weight.get(CLUSTERS[c]["confidence"], 8) for c in clusters[:2])
        data = 12 if rep["sub"] else 6
        if rep["role"] == "TOP" and rep["sub"] in ("KNIT", "SHIRT", "SWEATSHIRT", "CARDIGAN", "ZIPUP", "VEST"):
            data += 8
        if rep["role"] == "BOTTOM" and rep["sub"] in ("JEANS", "SLACKS", "PANTS", "SKIRT"):
            data += 8
        margin = 20 if rep["margin_pct"] >= 47 else (12 if rep["margin_pct"] >= 40 else 6)
        versa = 0
        if any(k in rep["title"] for k in NEUTRALS):
            versa += 10
        if 8000 <= rep["cost"] <= 25000:
            versa += 10
        ranked.append({
            "rep": rep, "members": [m["no"] for m in g], "member_count": len(g),
            "clusters": clusters,
            "score": {"TREND": min(trend, 40), "DATA": min(data, 20), "MARGIN": margin,
                      "VERSATILITY": versa, "TOTAL": min(trend, 40) + min(data, 20) + margin + versa},
        })
    ranked.sort(key=lambda r: (-r["score"]["TOTAL"], r["rep"]["cost"]))
    out = {"stats": stats, "unique_groups": len(ranked), "clusters": CLUSTERS, "groups": ranked}
    json.dump(out, sys.stdout, ensure_ascii=False)
    by_gb = {}
    for r in ranked:
        by_gb.setdefault((r["rep"]["gender"], r["rep"]["role"]), []).append(r)
    summary = {f"{k[0]}-{k[1]}": len(v) for k, v in sorted(by_gb.items())}
    sys.stderr.write("stats " + json.dumps(stats) + "\ngroups " + str(len(ranked)) + "\n")
    sys.stderr.write("by_gender_role " + json.dumps(summary, ensure_ascii=False) + "\n")

if __name__ == "__main__":
    main()
