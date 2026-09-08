#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — 도매꾹 OpenAPI 소싱 풀 수집 (STEP 9)
기존 검증 어댑터(HERMES n1_md/sources.py DomeggookOpenApiAdapter) 로직 재사용.
API 키는 실행 셸이 env로 주입(DOMEGGOOK_API_KEY) — 소스에 키 없음, 값 출력 금지.
파일 I/O 없음 — JSON을 stdout으로 출력. 셸 리다이렉션으로 저장.
보완: 고정 https + 고정 호스트 검증, 리다이렉트 미추종."""
import json, os, sys, time, urllib.request, urllib.parse

ALLOWED_HOST = "www.domeggook.com"
API_PATH = "/ssl/api/"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

_opener = urllib.request.build_opener(NoRedirect)

def fetch_list(key, kw, sz=50, pg=1, so="se"):
    params = {"ver": "4.1", "mode": "getItemList", "aid": key, "market": "dome",
              "om": "json", "kw": kw, "sz": sz, "pg": pg, "so": so}
    query = urllib.parse.urlencode(params)
    url = urllib.parse.ParseResult(scheme="https", netloc=ALLOWED_HOST,
                                   path=API_PATH, params="", query=query, fragment="").geturl()
    assert url.startswith("https://" + ALLOWED_HOST + API_PATH), "host guard"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _opener.open(req, timeout=25) as r:
        d = json.loads(r.read().decode('utf-8', 'replace'))
    if d.get("errors"):
        return [], json.dumps(d.get("errors"), ensure_ascii=False)[:120]
    items = d.get("domeggook", {}).get("list", {}).get("item", [])
    return items, None

KEYWORDS = [
    "남성 하프집업 니트", "남성 브이넥 니트", "남성 터틀넥 니트",
    "남성 옥스포드 셔츠", "남성 워셔블 셔츠", "남성 체크 셔츠",
    "남성 기모 맨투맨", "남성 스웨트셔츠", "남성 니트 가디건",
    "남성 스트레이트 데님", "남성 부츠컷 데님", "남성 세미와이드 슬랙스",
    "남성 코듀로이 팬츠", "남성 와이드 트레이닝",
    "여성 브이넥 니트", "여성 라운드 니트", "여성 가디건",
    "여성 니트 베스트", "여성 셔츠 블라우스", "여성 피그먼트 티셔츠",
    "여성 부츠컷 데님", "여성 세미와이드 슬랙스", "여성 미디 스커트",
    "여성 코듀로이",
    "무지 긴팔 티셔츠", "피그먼트 맨투맨", "남녀공용 와이드 팬츠", "후드 스웨트셔츠",
    # 젠더리스 보강 — 타입 다양화 (§23 DIFFERENTIATION)
    "남녀공용 셔츠", "남녀공용 니트", "남녀공용 가디건", "남녀공용 카디건",
    "남녀공용 니트 조끼", "남녀공용 스웨트셔츠",
    "남녀공용 데님", "남녀공용 슬랙스", "남녀공용 밴딩 팬츠", "남녀공용 스커트",
]

def main():
    key = os.environ.get("DOMEGGOOK_API_KEY", "")
    if not key:
        print(json.dumps({"error": "NO KEY"}))
        sys.exit(1)
    ALL = []
    errs = {}
    log = []
    for kw in KEYWORDS:
        try:
            items, err = fetch_list(key, kw)
            if err:
                errs[kw] = err
            for it in items:
                ALL.append({
                    "kw": kw,
                    "no": str(it.get("no", "")),
                    "title": it.get("title", ""),
                    "price": int(it.get("price") or 0),
                    "url": it.get("url", ""),
                    "thumb": it.get("thumb", ""),
                    "unitQty": it.get("unitQty"),
                    "market": it.get("market"),
                    "deli": it.get("deli"),
                })
            log.append(f"{kw}: {len(items)}")
        except Exception as e:
            errs[kw] = str(e)[:120]
            log.append(f"{kw}: ERR {str(e)[:80]}")
        time.sleep(0.4)
    uniq = set(a["no"] for a in ALL)
    log.append(f"TOTAL {len(ALL)} unique {len(uniq)}")
    sys.stderr.write("\n".join(log) + "\n")
    if errs:
        sys.stderr.write("ERRORS " + json.dumps(errs, ensure_ascii=False)[:400] + "\n")
    print(json.dumps({"fetched_at": time.strftime('%Y-%m-%dT%H:%M:%S'),
                      "count": len(ALL), "items": ALL}, ensure_ascii=False))

if __name__ == "__main__":
    main()
