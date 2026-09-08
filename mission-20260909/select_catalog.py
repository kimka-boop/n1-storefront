#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — 카탈로그 최종 선별 + customer-facing 네이밍 (STEP 11-12)
stdin: candidate_enriched.json  stdout: catalog_selected.json
선별 정책 (§23 scoring + §25 dedup + §27 naming):
- 슬롯: MALE 8T+8B / FEMALE 8T+8B / GENDERLESS 6T+6B = 44
- 키워드 소스 다양화: 동일 검색 키워드에서 최대 2개
- 컬러 다양성: 컬렉션 뷰당 중립색 과밀 방지 (§39-H)
- unitQty=1 우선 (단품 위탁 구조)
- 네이밍: supplier SEO 제목 폐기, 핵심 아이템타입+디스크립터로 재작성 (§27)
- UNKNOWN ≠ FACT: 미확인 필드는 UNKNOWN 유지 (§22)"""
import json, re, sys
from collections import Counter

CORE_TYPES = [
    ("가디건", ["가디건"]),
    ("니트 베스트", ["니트베스트", "니트 베스트", "베스트 니트", "조끼 니트"]),
    ("니트", ["니트", "스웨터", "털니트", "울니트"]),
    ("맨투맨", ["맨투맨", "스웨트셔츠", "스웨트 셔츠"]),
    ("후드", ["후드"]),
    ("집업", ["집업", "반집업"]),
    ("셔츠", ["셔츠", "남방"]),
    ("블라우스", ["블라우스"]),
    ("티셔츠", ["티셔츠", "티셔"]),
    ("데님", ["데님", "청바지", "데님팬츠"]),
    ("슬랙스", ["슬랙스"]),
    ("스커트", ["스커트", "치마"]),
    ("트레이닝", ["트레이닝", "조거", "츄리닝"]),
    ("팬츠", ["팬츠", "바지"]),
]
DESCRIPTORS = [
    ("브이넥", ["브이넥", "브이 넥", "v넥"]),
    ("터틀넥", ["터틀넥", "터틀 넥", "폴라"]),
    ("하프집업", ["하프집업", "하프 집업"]),
    ("쿼터집업", ["쿼터집업", "쿼터 집업", "쿼터"]),
    ("옥스포드", ["옥스포드"]),
    ("체크", ["체크", "체커", "플레이드"]),
    ("스트라이프", ["스트라이프", "스트라이프", "줄무늬"]),
    ("기모", ["기모"]),
    ("울블렌드", ["울 블렌드", "울블렌드", "울 혼방", "울혼방"]),
    ("피그먼트", ["피그먼트", "워싱", "와싱", "빈티지", "오버다이"]),
    ("루즈핏", ["루즈", "루즈핏"]),
    ("오버핏", ["오버핏", "오버 핏", "오버사이즈", "빅사이즈"]),
    ("세미와이드", ["세미와이드", "세미 와이드"]),
    ("와이드", ["와이드"]),
    ("스트레이트", ["스트레이트", "일자"]),
    ("부츠컷", ["부츠컷", "부츠 컷"]),
    ("테이퍼드", ["테이퍼드", "테이퍼"]),
    ("밴딩", ["밴딩"]),
    ("미디", ["미디", "롱기장"]),
    ("펜슬", ["펜슬", "H라인", "에이라인"]),
    ("코듀로이", ["코듀로이"]),
    ("카고", ["카고"]),
    ("오프숄더", ["오프숄더"]),
]
COLORS = ["블랙", "화이트", "아이보리", "크림", "베이지", "브라운", "카멜", "초콜릿",
          "버건디", "와인", "올리브", "카키", "네이비", "그레이", "차콜", "핑크",
          "레드", "블루", "그린", "머스타드", "옐로우", "와일", "연청", "진청", "흑청", "인디고"]

def core_type(title):
    for name, kws in CORE_TYPES:
        for k in kws:
            if k in title:
                return name
    return ""

def descriptors(title):
    out = []
    for name, kws in DESCRIPTORS:
        if any(k in title for k in kws):
            out.append(name)
    return out[:2]

def color_tokens(title):
    return [c for c in COLORS if c in title]

DESCRIPTOR_SUBSUMES = {"와이드": "세미와이드", "와이드팬츠": "세미와이드"}

def make_name(rep):
    ct = core_type(rep["title"])
    ds = descriptors(rep["title"])
    cols = color_tokens(rep["title"])
    if not ct:
        return ""
    # 서브세이션: 상위 디스크립터가 있으면 중복 표현 제거 (세미와이드+와이드 → 세미와이드)
    ds = [d for d in ds if d not in DESCRIPTOR_SUBSUMES or DESCRIPTOR_SUBSUMES[d] not in ds]
    parts = []
    if cols:
        parts.append(cols[0])
    for d in ds:
        if d not in parts:
            parts.append(d)
    name = " ".join(parts + [ct]).strip()
    name = re.sub(r"\s+", " ", name).strip()
    # 사이즈/기장 숫자 토큰 잔존 제거 (예: "셔츠 158")
    name = " ".join(tok for tok in name.split() if not tok.isdigit()).strip()
    return name[:24]

GENDER_KO = {"MALE": "남성", "FEMALE": "여성", "GENDERLESS": "남녀공용"}

def main():
    data = json.load(sys.stdin)
    enr = data["enriched"]
    PLAN = {"MALE": ("TOP", 8, "BOTTOM", 8), "FEMALE": ("TOP", 8, "BOTTOM", 8),
            "GENDERLESS": ("TOP", 6, "BOTTOM", 6)}
    picked = []
    used_no, used_names = set(), set()
    for gender, (trole, tcount, brole, bcount) in PLAN.items():
        for role, count in ((trole, tcount), (brole, bcount)):
            pool = [g for g in enr
                    if g["rep"]["gender"] == gender and g["rep"]["role"] == role
                    and g["rep"]["no"] not in used_no
                    and make_name(g["rep"]) not in used_names
                    and str(g["detail"]["soldout"]).startswith("NO")]
            pool.sort(key=lambda g: (-g["score"]["TOTAL"], g["member_count"], g["rep"]["cost"]))
            chosen, kw_count, sub_count = [], Counter(), Counter()
            chosen_bases = set()
            sub_cap = 2 if count <= 6 else 3
            # 패스1: 스코어 순 + 키워드 다양화(≤2) + 서브타입 다양화(≤cap) + 이름 중복 방지
            for g in pool:
                if len(chosen) >= count:
                    break
                base = make_name(g["rep"])
                if base in chosen_bases:
                    continue
                kw = g["rep"]["kw"]
                if kw_count[kw] >= 2:
                    continue
                if sub_count[g["rep"]["sub"]] >= sub_cap:
                    continue
                uq = str(g["detail"].get("unitQty") or "")
                if "2" in uq or "3" in uq:
                    continue
                chosen.append(g)
                chosen_bases.add(base)
                kw_count[kw] += 1
                sub_count[g["rep"]["sub"]] += 1
                used_no.add(g["rep"]["no"])
            # 패스2: 부족분 — 서브 과밀 최소화 + 이름 중복 방지 유지
            if len(chosen) < count:
                for g in sorted(pool, key=lambda x: (sub_count[x["rep"]["sub"]], -x["score"]["TOTAL"])):
                    if len(chosen) >= count:
                        break
                    if g in chosen or make_name(g["rep"]) in chosen_bases:
                        continue
                    chosen.append(g)
                    chosen_bases.add(make_name(g["rep"]))
                    sub_count[g["rep"]["sub"]] += 1
                    used_no.add(g["rep"]["no"])
            picked.extend(chosen)
    # 네이밍 + 중복 이름 방지
    seen_names = Counter()
    catalog = []
    for g in picked:
        rep, d = g["rep"], g["detail"]
        name = make_name(rep)
        if not name:
            continue
        seen_names[name] += 1
        if seen_names[name] > 1:
            cols2 = [c for c in color_tokens(rep["title"]) if c not in name]
            cand = f"{name} {cols2[0]}" if cols2 else f"{name} {GENDER_KO[rep['gender']]}"
            if seen_names[cand]:
                cand = f"{name} #{rep['no'][-2:]}"
            seen_names[cand] += 1
            name = cand
        catalog.append({
            "product_id": f"PRD-N1-{len(catalog)+1:02d}",
            "raw_name": rep["title"][:80],
            "name": name,
            "gender": rep["gender"],
            "top_bottom": "의류-상의" if rep["role"] == "TOP" else "의류-하의",
            "sub": rep["sub"],
            "cost": rep["cost"], "retail": rep["retail"], "margin_pct": rep["margin_pct"],
            "colors": color_tokens(rep["title"]),
            "sizes": [],  # 옵션 사이즈는 공급 페이지 미노출 → UNKNOWN (재고확정 게이트에서 채움)
            "material": d["material"], "care": d["care"],
            "manufacturer": d["manufacturer"], "origin": d["origin"], "madeAt": d["madeAt"],
            "cluster_ids": g["clusters"],
            "score": g["score"],
            "source_site": "도매꾹",
            "source_url": rep["url"], "source_product_id": rep["no"],
            "source_image": d["og_image"],
            "kw": rep["kw"],
            "audit": {"price": "VERIFIED(api)" if d["price_page"] is None else d["price_verified"],
                      "options": "TITLE_TOKENS_ONLY" if (d["colors"] or color_tokens(rep["title"])) else "UNKNOWN",
                      "soldout": d["soldout"],
                      "member_count": g["member_count"]},
        })
    by_gb = Counter((c["gender"], c["top_bottom"]) for c in catalog)
    cl = Counter(cid for c in catalog for cid in c["cluster_ids"])
    out = {"count": len(catalog), "distribution": {f"{k[0]}-{k[1]}": v for k, v in sorted(by_gb.items())},
           "cluster_counts": dict(cl), "catalog": catalog}
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stderr.write(json.dumps({f"{k[0]}-{k[1]}": v for k, v in sorted(by_gb.items())}, ensure_ascii=False) + "\n")
    sys.stderr.write("clusters " + json.dumps(dict(cl), ensure_ascii=False) + "\n")

if __name__ == "__main__":
    main()
