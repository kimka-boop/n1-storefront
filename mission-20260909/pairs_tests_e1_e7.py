#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 SESSION E (TASK 26) — Pairing Engine 인수 테스트 E1–E7.

정책: N1_PAIRING_POLICY_V1 (HERMES 소유) / 구현: pairs_compute.py
대상: (a) 엔진 순수 함수 — 합성 fixture, (b) 배포된 pairing_results.json — 실측 불변식.

실행: python pairs_tests_e1_e7.py
  E1 valid top-bottom   유효 상×하의 조합과 계약 필드
  E2 duplicate exposure 1:1 매칭 — 동일 상품 중복 노출 금지, 그리디 금지
  E3 unmatched          미매칭 상한(스코프당 4) — 나쁜 조합 강제 금지
  E4 bad data           불량 데이터 하드게이트
  E5 gender scope       스코프 교차 페어 금지
  E6 unavailable        판매불가 상품 제외
  E7 deterministic      동일 입력 → 동일 출력 (배포 아티팩트와 바이트 일치)
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pairs_compute as pc  # noqa: E402


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return json.load(f)


CATALOG = load("catalog_selected.json")
RESULTS = load("pairing_results.json")
PAIRS = RESULTS["pairs"]
BY_ID = {p["product_id"]: p for p in CATALOG["catalog"]}

PUBLIC_FIELDS = {  # lib/pairs.ts CatalogPair — 고객 노출 허용 필드만 (§9)
    "pairId", "collectionScope", "scopeLabel",
    "topProductId", "bottomProductId", "trendClusters", "pairReasonShort",
}


def prod(pid="T1", gender="MALE", cat="의류-상의", sub="SHIRT", name="블랙 셔츠",
         colors=None, clusters=None, cost=10000, retail=20000, **over):
    p = {
        "product_id": pid, "raw_name": name, "name": name, "gender": gender,
        "top_bottom": cat, "sub": sub, "cost": cost, "retail": retail,
        "colors": ["블랙"] if colors is None else colors,
        "cluster_ids": ["T02"] if clusters is None else clusters,
        "material": "UNKNOWN", "audit": {"soldout": "NO(API 판매중)"},
    }
    p.update(over)
    return p


_FULL = None


def full_compute():
    """배치 1회 재계산 공유 (8! 전수 탐색 — 캐시 없으면 테스트마다 수십 초)."""
    global _FULL
    if _FULL is None:
        _FULL, _notes = pc.compute(CATALOG)
    return _FULL


# ── E1 valid top-bottom ─────────────────────────────────────────────────────

class E1ValidTopBottom(unittest.TestCase):
    def test_every_pair_is_top_x_bottom(self):
        for p in PAIRS:
            top, bot = BY_ID[p["top_product_id"]], BY_ID[p["bottom_product_id"]]
            self.assertEqual(top["top_bottom"], pc.TOP_CAT, p["pair_id"])
            self.assertEqual(bot["top_bottom"], pc.BOTTOM_CAT, p["pair_id"])

    def test_both_sides_pass_hard_gates(self):
        for p in PAIRS:
            self.assertTrue(pc.passes_hard_gates(BY_ID[p["top_product_id"]]), p["pair_id"])
            self.assertTrue(pc.passes_hard_gates(BY_ID[p["bottom_product_id"]]), p["pair_id"])

    def test_tier_matches_thresholds(self):
        for p in PAIRS:
            s = p["pair_score_internal"]
            want = ("BEST_MATCH" if s >= pc.BEST_FLOOR else
                    "SECONDARY" if s >= pc.SECONDARY_FLOOR else "BELOW_THRESHOLD")
            self.assertEqual(p["tier"], want, p["pair_id"])

    def test_breakdown_sums_to_total(self):
        for p in PAIRS:
            b = dict(p["score_breakdown"])
            total = b.pop("total")
            self.assertEqual(sum(b.values()), total, p["pair_id"])
            self.assertEqual(p["pair_score_internal"], total, p["pair_id"])

    def test_reason_present_and_quiet(self):
        for p in PAIRS:
            r = p["pair_reason_short"]
            self.assertTrue(r.strip(), p["pair_id"])
            for banned in ("%", "점", "AI", "추천 정확도", "매칭률"):
                self.assertNotIn(banned, r, p["pair_id"])  # §9 스코어 노출 금지

    def test_public_contract_carries_no_internal_score(self):
        """프론트엔드 계약 필드 세트에 내부 스코어가 없어야 한다 (§9)."""
        exposed = {"pairId", "collectionScope", "scopeLabel", "topProductId",
                   "bottomProductId", "trendClusters", "pairReasonShort"}
        self.assertTrue(exposed <= PUBLIC_FIELDS)
        for f in exposed:
            self.assertNotIn("score", f.lower())


# ── E2 duplicate exposure ───────────────────────────────────────────────────

class E2DuplicateExposure(unittest.TestCase):
    def test_pair_ids_unique(self):
        ids = [p["pair_id"] for p in PAIRS]
        self.assertEqual(len(ids), len(set(ids)))

    def test_no_product_in_two_pairs(self):
        seen = []
        for p in PAIRS:
            seen += [p["top_product_id"], p["bottom_product_id"]]
        self.assertEqual(len(seen), len(set(seen)),
                         "1:1 매칭 위반 — 동일 상품이 2개 페어에 등장")

    def test_max_weight_beats_greedy(self):
        """그리디(최고 쌍 우선)가 놓치는 전체 최적해를 엔진이 잡는다."""
        tops = [{"id": "T1"}, {"id": "T2"}]
        bots = [{"id": "B1"}, {"id": "B2"}]
        table = {("T1", "B1"): 90, ("T1", "B2"): 85,
                 ("T2", "B1"): 88, ("T2", "B2"): 60}
        orig = pc.pair_score
        pc.pair_score = lambda a, b: {"total": table[(a["id"], b["id"])]}
        try:
            perm, _ = pc.brute_match(tops, bots, floor=0, diversity=False)
        finally:
            pc.pair_score = orig
        chosen = {(tops[i]["id"], bots[perm[i]]["id"]) for i in range(len(tops))}
        self.assertEqual(chosen, {("T1", "B2"), ("T2", "B1")})  # 173 > 그리디 150

    def test_matching_is_one_to_one_synthetic(self):
        tops = [prod(f"T{i}") for i in range(1, 4)]
        bots = [prod(f"B{i}", cat=pc.BOTTOM_CAT, sub="SLACKS") for i in range(1, 4)]
        perm, _ = pc.brute_match(tops, bots, floor=0)
        self.assertEqual(sorted(perm), [0, 1, 2])  # bottom 인덱스 중복 없음


# ── E3 unmatched ────────────────────────────────────────────────────────────

class E3Unmatched(unittest.TestCase):
    def test_unmatched_within_cap_and_located(self):
        paired = {p["top_product_id"] for p in PAIRS} | {p["bottom_product_id"] for p in PAIRS}
        unmatched = [p for p in CATALOG["catalog"] if p["product_id"] not in paired]
        self.assertEqual(len(unmatched), 4, "선행 배치 불변식: 미매칭 4개")
        per_scope = {}
        for p in unmatched:
            per_scope.setdefault(p["gender"], []).append(p["top_bottom"])
        self.assertEqual(set(per_scope), {"FEMALE"})
        self.assertEqual(sorted(per_scope["FEMALE"]),
                         sorted([pc.TOP_CAT] * 2 + [pc.BOTTOM_CAT] * 2))
        for g, cats in per_scope.items():
            self.assertLessEqual(len(cats), pc.UNMATCHED_CAP_PER_SCOPE, g)

    def test_below_threshold_excluded_from_primary(self):
        below = [p for p in PAIRS if p["tier"] == "BELOW_THRESHOLD"]
        self.assertEqual(len(below), 3, "선행 배치 불변식: 미달 3쌍")
        primary = [p for p in PAIRS if p["tier"] != "BELOW_THRESHOLD"]
        for p in below:
            self.assertNotIn(p, primary)
            self.assertLess(p["pair_score_internal"], pc.SECONDARY_FLOOR)

    def test_floor_preferred_over_forced_bad_pair(self):
        """플로어 미달을 피해 매칭 수를 줄인다 — 나쁜 조합을 억지로 만들지 않는다.
        (k 축소 시 제외 대상은 카탈로그 순서 후미부터 — 정책 §8 한계 고지)"""
        tops = [prod("TB"), prod("TA", name="체크 오버핏 셔츠")]  # 불량 후보 TA는 후미
        bots = [prod("BA", cat=pc.BOTTOM_CAT, sub="SLACKS", name="체크 슬랙스"),
                prod("BB", cat=pc.BOTTOM_CAT, sub="SLACKS")]
        orig = pc.pair_score
        pc.pair_score = lambda a, b: ({"total": 50} if a["product_id"] == "TA"
                                      else {"total": 90})
        try:
            perm, _ = pc.brute_match(tops, bots, floor=pc.SECONDARY_FLOOR)
        finally:
            pc.pair_score = orig
        matched = {tops[i]["product_id"] for i in range(len(perm))}
        self.assertNotIn("TA", matched)  # 50점 짜리 강제 페어 없음
        self.assertIn("TB", matched)

    def test_short_side_still_pairs(self):
        tops = [prod(f"T{i}") for i in range(1, 4)]  # top 3
        bots = [prod("B1", cat=pc.BOTTOM_CAT, sub="SLACKS"),
                prod("B2", cat=pc.BOTTOM_CAT, sub="SLACKS")]  # bottom 2
        perm, _ = pc.brute_match(tops, bots, floor=0)
        self.assertEqual(len(perm), 2)  # min(n,m)쌍 — 크래시/전체 스킵 없음


# ── E4 bad data ─────────────────────────────────────────────────────────────

class E4BadData(unittest.TestCase):
    def test_missing_identifiers_gated(self):
        base = prod()
        for field in ("product_id", "name", "cost", "retail"):
            bad = dict(base)
            bad[field] = ""
            self.assertFalse(pc.passes_hard_gates(bad), field)

    def test_illegal_category_gated(self):
        self.assertFalse(pc.passes_hard_gates(prod(cat="의류-아우터")))
        self.assertFalse(pc.passes_hard_gates(prod(cat="")))

    def test_unknown_color_is_neutral_not_guess(self):
        a = prod(colors=[])
        b = prod(pid="B1", cat=pc.BOTTOM_CAT, sub="SLACKS", colors=[])
        self.assertEqual(pc.color_score(a, b), 13)  # §4 미확인쌍
        self.assertEqual(pc.color_score(prod(), b), 15)  # 일측 미확인

    def test_partial_cluster_data_scores_lower_confidence(self):
        a = prod(clusters=[])
        b = prod(pid="B1", cat=pc.BOTTOM_CAT, sub="SLACKS")
        s = pc.pair_score(a, b)
        self.assertEqual(s["data"], 3)
        self.assertEqual("HIGH" if s["data"] >= 5 else "MEDIUM", "MEDIUM")

    def test_corrupted_product_excluded_but_batch_survives(self):
        good = [prod(f"T{i}") for i in range(1, 3)]
        bots = [prod(f"B{i}", cat=pc.BOTTOM_CAT, sub="SLACKS") for i in range(1, 3)]
        bad = prod("PRD-BAD", cat=pc.BOTTOM_CAT, sub="SLACKS",
                   name="", cost=None, colors=["미확인"], clusters=[])
        out, _ = pc.compute({"catalog": good + bots + [bad]})
        ids = {p["top_product_id"] for p in out["pairs"]} | {p["bottom_product_id"] for p in out["pairs"]}
        self.assertNotIn("PRD-BAD", ids)
        self.assertEqual(len(out["pairs"]), 2)  # 정상 2T×2B는 그대로 매칭된다


# ── E5 gender scope ─────────────────────────────────────────────────────────

class E5GenderScope(unittest.TestCase):
    def test_shipped_pairs_share_scope(self):
        for p in PAIRS:
            self.assertEqual(p["collection_scope"], BY_ID[p["top_product_id"]]["gender"], p["pair_id"])
            self.assertEqual(p["collection_scope"], BY_ID[p["bottom_product_id"]]["gender"], p["pair_id"])

    def test_partition_isolates_scopes(self):
        male_top = prod("MT", gender="MALE")
        female_bot = prod("FB", gender="FEMALE", cat=pc.BOTTOM_CAT, sub="SLACKS")
        scopes = pc.partition_scopes([male_top, female_bot])
        self.assertIn(male_top, scopes["MALE"][0])
        self.assertNotIn(female_bot, scopes["MALE"][1])
        self.assertIn(female_bot, scopes["FEMALE"][1])
        self.assertEqual(scopes["FEMALE"][0], [])

    def test_cross_scope_pairing_impossible_synthetic(self):
        data = {"catalog": [prod("MT", gender="MALE"),
                            prod("FB", gender="FEMALE", cat=pc.BOTTOM_CAT, sub="SLACKS")]}
        out, _ = pc.compute(data)
        self.assertEqual(out["pairs"], [])  # 어느 스코프에서도 후보가 되지 못한다


# ── E6 unavailable ──────────────────────────────────────────────────────────

class E6Unavailable(unittest.TestCase):
    def test_soldout_gated(self):
        self.assertFalse(pc.passes_hard_gates(
            prod(audit={"soldout": "YES(품절)"})))
        self.assertFalse(pc.passes_hard_gates(
            prod(audit={"soldout": "SOLD OUT"})))
        self.assertFalse(pc.passes_hard_gates(prod(publish_ready=False)))

    def test_missing_audit_token_is_not_rejection(self):
        self.assertTrue(pc.passes_hard_gates(prod(audit={})))  # §8 uncertainty

    def test_unavailable_bottom_excluded_synthetic(self):
        data = {"catalog": [prod("T1"),
                            prod("B1", cat=pc.BOTTOM_CAT, sub="SLACKS",
                                 audit={"soldout": "YES(품절)"})]}
        out, _ = pc.compute(data)
        self.assertEqual(out["pairs"], [])


# ── E7 deterministic repeatability ──────────────────────────────────────────

class E7Deterministic(unittest.TestCase):
    def test_compute_is_pure(self):
        small = {"catalog": [prod("T1"), prod("T2"),
                             prod("B1", cat=pc.BOTTOM_CAT, sub="SLACKS"),
                             prod("B2", cat=pc.BOTTOM_CAT, sub="SLACKS")]}
        a, _ = pc.compute(small)
        b, _ = pc.compute(small)
        self.assertEqual(json.dumps(a, ensure_ascii=False),
                         json.dumps(b, ensure_ascii=False))

    def test_matches_shipped_artifact(self):
        """배포된 pairing_results.json = 엔진 재계산 결과 (바이트 동일)."""
        out = full_compute()
        with open(os.path.join(HERE, "pairing_results.json"), encoding="utf-8") as f:
            shipped = f.read()
        self.assertEqual(json.dumps(out, ensure_ascii=False) + "\n", shipped)

    def test_pair_order_and_ids_stable(self):
        out = full_compute()
        self.assertEqual([p["pair_id"] for p in out["pairs"]],
                         [p["pair_id"] for p in PAIRS])
        self.assertEqual(RESULTS["policy"], pc.POLICY_ID)
        self.assertTrue(all(p["verified_at"] == pc.VERIFIED_AT for p in out["pairs"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
