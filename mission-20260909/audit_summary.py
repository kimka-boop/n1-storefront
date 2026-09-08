#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""enrichment 결과 요약 — stdout 전용 (파일 I/O 없음)"""
import json, sys

d = json.load(sys.stdin)
enr = d["enriched"]
print("enriched:", len(enr))
mv = [e for e in enr if e["detail"].get("price_verified", "UNKNOWN").startswith(("MATCH", "DIFF"))]
print("price verified:", len(mv))
mat = [e for e in enr if e["detail"].get("material") not in (None, "UNKNOWN")]
print("material found:", len(mat))
col = [e for e in enr if e["detail"].get("colors")]
print("colors found:", len(col))
sz = [e for e in enr if e["detail"].get("sizes")]
print("sizes found:", len(sz))
so = [e for e in enr if e["detail"].get("soldout") != "NO"]
print("soldout flags:", len(so))
img = [e for e in enr if e["detail"].get("og_image")]
print("og_image found:", len(img))
for e in enr[:8]:
    dd = e["detail"]
    print(e["rep"]["no"], e["rep"]["gender"], e["rep"]["role"], "|",
          e["rep"]["title"][:26], "| price:", dd.get("price_verified"),
          "| mat:", str(dd.get("material"))[:20], "| col:", dd.get("colors")[:3],
          "| sz:", dd.get("sizes")[:4], "| so:", dd.get("soldout"))
