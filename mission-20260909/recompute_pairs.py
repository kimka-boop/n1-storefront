#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 SESSION E — pairing_results.json 재생성 래퍼 (TASK 26).

pairs_compute.compute()의 순수 함수 출력을 그대로 파일로 보관한다.
재계산 트리거(§10): 신규 상품 / unavailable / 시즌 전환 / trend cluster 업데이트.
재실행 전 조건: pairs_tests_e1_e7.py 전량 통과 + 배치 상수(VERIFIED_AT·BATCH_DATE) 갱신.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pairs_compute  # noqa: E402


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "catalog_selected.json"), encoding="utf-8") as f:
        data = json.load(f)
    out, notes = pairs_compute.compute(data)
    for n in notes:
        print(n, file=sys.stderr)
    path = os.path.join(here, "pairing_results.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False)
        f.write("\n")
    best = sum(1 for p in out["pairs"] if p["tier"] == "BEST_MATCH")
    below = sum(1 for p in out["pairs"] if p["tier"] == "BELOW_THRESHOLD")
    print(f"pairing_results.json <- {len(out['pairs'])} pairs (best {best}, below {below})")


if __name__ == "__main__":
    main()
