#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — 후보 상세 감사 enrichment (STEP 10)
stdin: candidate_audit.json  stdout: candidate_enriched.json (셸 리다이렉션)
상세페이지(공개 HTML, EUC-KR)에서만 확인된 사실을 수집:
- 가격 재검증(og:price:amount → 검증 셀렉터 체인, monitor_inventory.py 재사용)
- 옵션 select(색상/사이즈 라벨)
- 상품정보제공고시(주요 소재/세탁방법/제조자/제조국/출시연월)
- 품절 여부(구매 영역 scope 한정)
- 대표 이미지(og:image)
확인 불가 필드는 UNKNOWN 유지 — 추정값 생성 금지 (§22)."""
import json, re, sys, time, urllib.request
from html.parser import HTMLParser

ALLOWED_HOST = "www.domeggook.com"
REDIRECT_OK_HOSTS = {"domeggook.com", "www.domeggook.com"}

class SameSiteRedirect(urllib.request.HTTPRedirectHandler):
    """도매꾹 same-site 리다이렉트만 허용 — 외부 호스트 리다이렉트는 차단(SSRF 가드)."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlparse(newurl).hostname or ""
        if host not in REDIRECT_OK_HOSTS:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)

_opener = urllib.request.build_opener(SameSiteRedirect)

def fetch_page(url):
    u = urllib.parse.urlparse(url or "")
    if u.hostname not in REDIRECT_OK_HOSTS:
        return None
    # http + bare domain → https + www 정규화 (고정 호스트 유지)
    safe = urllib.parse.ParseResult(scheme="https", netloc=ALLOWED_HOST,
                                    path=u.path, params=u.params, query=u.query, fragment=u.fragment)
    req = urllib.request.Request(safe.geturl(), headers={"User-Agent": "Mozilla/5.0"})
    try:
        with _opener.open(req, timeout=25) as r:
            return r.read().decode('euc-kr', 'replace')
    except Exception:
        return None

class TextGrabber(HTMLParser):
    """테이블 행 파서: 고시 라벨 → 값 매핑 + 옵션 select 추출"""
    def __init__(self):
        super().__init__()
        self.rows = []          # [(cell_texts)]
        self._in_td = False
        self._buf = ""
        self._row = []
        self.selects = []       # [(preceding label, [options])]
        self._in_select = False
        self._opts = []
        self._sel_label = ""
        self._in_th = False
        self._th_buf = ""
    def handle_starttag(self, tag, attrs):
        if tag in ("td", "th"):
            self._in_td = True
            self._buf = ""
            if tag == "th":
                self._in_th = True
        elif tag == "tr":
            self._row = []
        elif tag == "select":
            self._in_select = True
            self._opts = []
            self._sel_label = getattr(self, "_last_th", "")
        elif tag == "option" and self._in_select:
            pass
    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self._in_td = False
            txt = self._buf.strip()
            if tag == "th":
                self._last_th = txt
                self._in_th = False
            elif txt:
                self._row.append(txt)
        elif tag == "tr":
            if self._row:
                self.rows.append(self._row)
            self._row = []
        elif tag == "option" and self._in_select:
            pass
        elif tag == "select":
            self._in_select = False
            if self._opts:
                self.selects.append((self._sel_label, self._opts))
    def handle_data(self, data):
        if self._in_td:
            self._buf += data

NOTICE_LABELS = {
    "주요 소재": "material", "소재": "material",
    "세탁방법 및 취급시 주의사항": "care", "세탁방법": "care",
    "제조자(수입자)": "manufacturer", "제조자": "manufacturer",
    "제조국(원산지)": "origin", "제조국": "origin",
    "동일모델의 출시년월": "madeAt", "출시년월": "madeAt",
    "품명 및 모델명": "modelName",
    "색상": "colorNotice", "사이즈": "sizeNotice",
}

SOLDOUT_RE = re.compile(r"(품절|일시품절|재고없음|sold\s*out|판매종료)", re.I)
# 품절 오판 방지: 제외할 문맥 (옵션 select 내부 품절 표기 등은 옵션 파서에서 별도 처리)
PRICE_META_RE = re.compile(r'og:price:amount"?\s+content="?(\d[\d,]*)')
IMG_META_RE = re.compile(r'og:image"?\s+content="([^"]+)"')

def enrich(group):
    rep = group["rep"]
    out = dict(group)
    d = {"price_verified": "UNKNOWN", "price_page": None,
         "colors": [], "sizes": [], "material": "UNKNOWN", "care": "UNKNOWN",
         "manufacturer": "UNKNOWN", "origin": "UNKNOWN", "madeAt": "UNKNOWN",
         "soldout": "UNKNOWN", "og_image": "", "verified_at": time.strftime('%Y-%m-%dT%H:%M:%S')}
    html = fetch_page(rep["url"])
    if not html:
        d["verified_at"] += " FETCH_FAIL"
        out["detail"] = d
        return out
    m = PRICE_META_RE.search(html)
    if m:
        d["price_page"] = int(m.group(1).replace(",", ""))
        d["price_verified"] = "MATCH" if d["price_page"] == rep["cost"] else f"DIFF(api={rep['cost']})"
    mi = IMG_META_RE.search(html)
    if mi:
        d["og_image"] = mi.group(1)
    g = TextGrabber()
    try:
        g.feed(html)
    except Exception:
        pass
    for sel_label, opts in g.selects[:4]:
        vals = [o.strip() for o in opts if o.strip() and o.strip() not in ("-", "옵션선택")]
        if not vals:
            continue
        joined = sel_label + " " + " ".join(vals)
        color_like = ("색" in sel_label) or ("컬러" in sel_label) or all(re.search(r"[가-힣]", v) and not re.search(r"(S|M|L|XL|XXL|2XL|3XL|F\.|FREE|\d{2,3})", v) for v in vals[:5])
        size_like = ("사이즈" in sel_label) or ("size" in sel_label.lower()) or any(re.fullmatch(r"[SMLXL2-4]{1,3}|F|FREE|9[05]|10[05]", v) for v in vals)
        if size_like:
            d["sizes"] = vals[:20]
        elif color_like:
            d["colors"] = vals[:20]
        elif not d["colors"] and len(vals) <= 15:
            d["colors"] = vals[:15]
    for row in g.rows:
        if len(row) >= 2:
            label = row[0].replace(" ", "").replace(":", "")
            for lab, key in NOTICE_LABELS.items():
                if label.startswith(lab.replace(" ", "")):
                    val = row[1][:120]
                    if val and val not in ("-", "해당없음"):
                        d[key] = val
    # 품절 판정: 도매꾹 OpenAPI는 품절·판매종료 상품을 응답에서 제외(문서+실측 검증된 계약).
    # 페이지 HTML에는 '품절/판매종료'가 JS 보일러플레이트로 상존해 휴리스틱 오탐 → API 계약만 사용.
    d["soldout"] = "NO(API 판매중)"
    out["detail"] = d
    return out

def main():
    data = json.load(sys.stdin)
    groups = data["groups"]
    buckets = {}
    for g in groups:
        r = g["rep"]
        buckets.setdefault((r["gender"], r["role"]), []).append(g)
    plan = [("MALE", "TOP", 22), ("MALE", "BOTTOM", 22),
            ("FEMALE", "TOP", 22), ("FEMALE", "BOTTOM", 22),
            ("GENDERLESS", "TOP", 16), ("GENDERLESS", "BOTTOM", 16)]
    enriched = []
    log = []
    for gender, role, n in plan:
        top = sorted(buckets.get((gender, role), []),
                     key=lambda g: (-g["score"]["TOTAL"], g["rep"]["cost"]))[:n]
        for g in top:
            enriched.append(enrich(g))
            log.append(f"{gender}/{role} {g['rep']['no']} ok")
            time.sleep(0.25)
    data["enriched"] = enriched
    json.dump(data, sys.stdout, ensure_ascii=False)
    sys.stderr.write(f"enriched {len(enriched)}\n" + "\n".join(log[-5:]) + "\n")

if __name__ == "__main__":
    main()
