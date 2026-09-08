#!/usr/bin/env node
/**
 * N1_TREND_SOURCING_REPORT_2026-09-09.pdf 빌더 (STEP 8 · §15-§20)
 * 실행 위치: mission-20260909/
 * ReportLab 소스를 python에 전달해 실행한다 (파일 I/O는 python 런타임에서,
 * 출력 파일명은 리터럴 N1_TREND_SOURCING_REPORT_2026-09-09.pdf).
 */
const { execFileSync } = require("child_process");

const PY = String.raw`
# -*- coding: utf-8 -*-
import json, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

W, H = A4
OUT = "N1_TREND_SOURCING_REPORT_2026-09-09.pdf"

# ── Fonts (로컬 우선: Windows Malgun Gothic — Korean) ──
pdfmetrics.registerFont(TTFont("N1Sans", r"C:\Windows\Fonts\malgun.ttf"))
pdfmetrics.registerFont(TTFont("N1SansB", r"C:\Windows\Fonts\malgunbd.ttf"))

# ━━ Palette (pdf.py palette.cascade — minimal) ━━
PAGE_BG      = colors.HexColor('#f7f7f6')
SECTION_BG   = colors.HexColor('#f2f2f1')
CARD_BG      = colors.HexColor('#e9e9e6')
TABLE_STRIPE = colors.HexColor('#eeedeb')
HEADER_FILL  = colors.HexColor('#514930')
COVER_BLOCK  = colors.HexColor('#7f7350')
BORDER       = colors.HexColor('#ccc5ae')
ICON         = colors.HexColor('#8e7835')
ACCENT       = colors.HexColor('#5027cc')
TEXT_PRIMARY = colors.HexColor('#1e1d1b')
TEXT_MUTED   = colors.HexColor('#78756e')

M = 22 * mm
cat = json.load(open("catalog_selected.json", encoding="utf-8"))
prs = json.load(open("pairing_results.json", encoding="utf-8"))
ev = json.load(open("N1_TREND_EVIDENCE/N1_TREND_EVIDENCE.json", encoding="utf-8"))

S = dict(
  kicker=ParagraphStyle("kicker", fontName="N1SansB", fontSize=8.5, leading=13,
                        textColor=TEXT_MUTED, alignment=TA_LEFT, spaceAfter=4),
  h1=ParagraphStyle("h1", fontName="N1SansB", fontSize=19, leading=26,
                    textColor=TEXT_PRIMARY, spaceBefore=6, spaceAfter=2),
  h2=ParagraphStyle("h2", fontName="N1SansB", fontSize=12.5, leading=18,
                    textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=5),
  body=ParagraphStyle("body", fontName="N1Sans", fontSize=9.5, leading=16.5,
                      textColor=TEXT_PRIMARY, spaceAfter=7),
  quiet=ParagraphStyle("quiet", fontName="N1Sans", fontSize=8.5, leading=13.5,
                       textColor=TEXT_MUTED, spaceAfter=5),
  src=ParagraphStyle("src", fontName="N1Sans", fontSize=7.4, leading=11,
                     textColor=TEXT_MUTED, spaceAfter=2, leftIndent=8),
  cell=ParagraphStyle("cell", fontName="N1Sans", fontSize=8.3, leading=12.5, textColor=TEXT_PRIMARY),
  cellm=ParagraphStyle("cellm", fontName="N1Sans", fontSize=7.6, leading=11, textColor=TEXT_MUTED),
)

def P(t, s="body"): return Paragraph(t, S[s])

def hr():
    t = Table([[""]], colWidths=[W - 2 * M], rowHeights=[0.6])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.6, BORDER),
                           ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t

def section_head(num, kicker, title):
    return [KeepTogether([
        P(f"{num} — {kicker}", "kicker"), P(title, "h1"), Spacer(1, 4), hr(), Spacer(1, 12)])
    ]

def data_table(header, rows, widths):
    data = [[Paragraph(h, S["cellm"]) for h in header]] + [[Paragraph(c, S["cell"]) for c in r] for r in rows]
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), SECTION_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, HEADER_FILL),
        ("LINEBELOW", (0, -1), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(rows) + 1, 2):
        style.append(("BACKGROUND", (0, i), (-1, i), TABLE_STRIPE))
    t.setStyle(TableStyle(style))
    return t

def on_page(c, doc):
    c.saveState()
    c.setFillColor(PAGE_BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFont("N1Sans", 7)
    c.setFillColor(TEXT_MUTED)
    c.drawString(M, H - 12 * mm, "N°1 — FW26 TREND AND SOURCING RESEARCH")
    c.drawRightString(W - M, H - 12 * mm, "2026-09-09")
    c.drawString(M, 10 * mm, "N°1 INTERNAL RESEARCH ARTIFACT")
    c.drawRightString(W - M, 10 * mm, f"{doc.page:02d}")
    c.restoreState()

def on_cover(c, doc):
    c.saveState()
    c.setFillColor(PAGE_BG); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setStrokeColor(BORDER); c.setLineWidth(0.8)
    c.line(M, 0.86 * H, W - M, 0.86 * H)
    c.line(M, 0.14 * H, W - M, 0.14 * H)
    c.setFont("N1SansB", 9); c.setFillColor(TEXT_MUTED)
    c.drawString(M, 0.885 * H, "N°1")
    c.drawRightString(W - M, 0.885 * H, "INTERNAL RESEARCH ARTIFACT — 2026-09-09")
    c.setFont("N1SansB", 30); c.setFillColor(TEXT_PRIMARY)
    c.drawString(M, 0.665 * H, "FW26 TREND RESEARCH")
    c.drawString(M, 0.665 * H - 13 * mm, "AND WHOLESALE SOURCING")
    c.setFont("N1Sans", 11.5); c.setFillColor(TEXT_MUTED)
    summary = ("2026-09 출시를 위한 20대~30초반 고객 리서치. 에디토리얼·커머스·브랜드·커뮤니티 "
               "네 축의 공개 소스 57곳에서 수집한 evidence 73건을 T01~T10 클러스터로 정리하고, "
               "도매꾹 OpenAPI 1,752건 중 44개 상품을 선별해 TOP×BOTTOM 20벌의 코디로 매칭했다.")
    y = 0.52 * H
    import textwrap
    for line in textwrap.wrap(summary, width=52)[:4]:
        c.drawString(M, y, line); y -= 7 * mm
    c.setFont("N1Sans", 9.5); c.setFillColor(TEXT_PRIMARY)
    meta = [
        ("SCOPE", "한국 20s~early 30s · 가을~초겨울 (FW26)"),
        ("SOURCES", "57 unique public sources · 4 families"),
        ("CATALOG", "44 products · 20 primary outfits"),
        ("PAIRING", "N1 OUTFIT PAIRING POLICY V1 — HERMES 비준"),
        ("STATUS", "RELEASE CANDIDATE — publish 대기 (Owner 승인 필요)"),
    ]
    yy = 0.335 * H
    for k, v in meta:
        c.setFont("N1SansB", 8); c.setFillColor(TEXT_MUTED)
        c.drawString(M, yy, k)
        c.setFont("N1Sans", 9.5); c.setFillColor(TEXT_PRIMARY)
        c.drawString(M + 22 * mm, yy, v)
        yy -= 6.6 * mm
    c.setFont("N1SansB", 8.5); c.setFillColor(TEXT_MUTED)
    c.drawString(M, 0.105 * H, "N°1 — 매주 일요일, 새로운 컬렉션")
    c.drawRightString(W - M, 0.105 * H, "01")
    c.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=18 * mm, bottomMargin=16 * mm,
                      title="N°1 FW26 Trend Research and Sourcing Report",
                      author="N°1 / ZCode for HERMES Master", subject="FW26 trend evidence, wholesale sourcing, product selection, pairing",
                      creator="N°1 Mission 20260909")
cover_frame = Frame(M, 16 * mm, W - 2 * M, H - 34 * mm, id="cover")
body_frame = Frame(M, 16 * mm, W - 2 * M, H - 34 * mm, id="body")
doc.addPageTemplates([PageTemplate(id="Cover", frames=[cover_frame], onPage=on_cover),
                      PageTemplate(id="Body", frames=[body_frame], onPage=on_page)])

story = []
from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate("Body"))
story.append(PageBreak())

KO = lambda g: {"MALE": "남성", "FEMALE": "여성", "GENDERLESS": "젠더리스"}.get(g, g)

# ── 02 EXECUTIVE SUMMARY ──
story += section_head("02", "EXECUTIVE SUMMARY", "한 문장 요약")
story += [
  P("2026-09-10 12:00 KST 출시를 위해, 공개 소스 57곳의 evidence 73건에서 FW26 트렌드 10개 클러스터를 도출하고, "
    "도매꾹 OpenAPI 풀 1,752건을 감사해 상품 44개(남성 16 / 여성 16 / 젠더리스 12)를 선별했다. "
    "선별 근거는 전건 레코드로 보존되며, N1 OUTFIT PAIRING POLICY V1(HERMES 비준)에 따라 TOP×BOTTOM 20벌의 "
    "1:1 코디가 산출되어 MASTER DB와 Pairs 시트에 반영되었다."),
  P("고신뢰(HIGH) 클러스터 5개 — 슬림·스트레이트 회귀, 니트 퍼스트, 브라운·어스 팔레트, 워싱·빈티지 파브, "
    "셔츠 레이어링 — 가 카탈로그 구성의 뼈대다. 스웨이드·레더 아우터 트렌드는 29CM 실측 데이터(+124% YoY)로 확인되지만 "
    "RC 카탈로그가 TOP×BOTTOM 페어 모델 전용이므로 아우터 SKU는 의도적으로 제외했다.", "quiet"),
  Spacer(1, 6),
  data_table(["항목", "값"],
    [["Evidence 레코드", "73건 (에디토리얼 19 · 커머스 10 · 브랜드 26 · 커뮤니티 18)"],
     ["고유 소스", "57곳 · 4 family (§8 no-bot-bypass 준수, 차단 시 SKIP 기록)"],
     ["소싱 풀", "도매꾹 OpenAPI 1,752건 → 감사 후 725 그룹 → 44 선별"],
     ["선별 사유 보존", "전 상품 trend_cluster_ids + selection_reason_internal 기록"],
     ["페어", "20벌 = BEST 5 + SECONDARY 12, 미달 3쌍은 primary 제외"],
     ["가격 정책", "판매가 = 도매가 × 1.9 (Owner 승인 마진 정책, ai_md.margin_pct 재사용)"]],
    [110, W - 2 * M - 110]),
  PageBreak(),
]

# ── 03 METHODOLOGY ──
story += section_head("03", "METHODOLOGY", "조사 방법 — evidence-first")
story += [
  P("네 개의 리서치 트랙이 병렬로 수행되었다. 각 트랙은 관찰(observation)과 주장(claim)을 구분해 기록하고, "
    "모든 레코드에 source_name · source_type · source_url · 발행/관측 일자 · 카테고리 · 키워드를 남겼다(§11)."),
  P("· Editorial — Vogue Korea, Elle Korea, Harper's Bazaar Korea, W Korea, Marie Claire Korea, Vogue.com 등", "quiet"),
  P("· Commerce — 무신사 에디토리얼, 29CM 판매데이터(TENANT 뉴스 경유), 지그재그 결산(Apparelnews 경유) 등", "quiet"),
  P("· Brand — thisisneverthat, Covernat, Mahagrid, Glowny, Matin Kim, COS, Uniqlo LifeWear 등 FW26 컬렉션/룩북", "quiet"),
  P("· Community — 네이버 블로그, 티스토리, GQ Korea, Threads, YouTube 메타데이터 등 공개 접근분", "quiet"),
  P("신뢰도는 독립 소스 수로만 환산했다: HIGH 3+ 소스 / MEDIUM 2 소스 / LOW 1 소스. "
    "판매량·검색량 같은 수요 주장은 관측된 수치(예: 29CM 거래액 +124%)를 제외하고 만들지 않았다(§14). "
    "봇 우회 금지(§8) — W Concept·29CM 랭킹·Zara 등 JS 월/차단 사이트는 SOURCE_UNAVAILABLE로 기록하고 건너뛰었다."),
  PageBreak(),
]

# ── 04 SOURCE MAP ──
story += section_head("04", "SOURCE MAP", "소스 지도 — 57곳 · 4 family")
fam_rows = [
  ["Editorial", "19", "Vogue Korea(8/31, 9/8 x2), Elle Korea x3, Bazaar Korea x3, W Korea, Marie Claire, Vogue.com x2"],
  ["Commerce", "10", "Musinsa editorial x5, 29CM 데이터(TENANT), Zigzag 결산(Apparelnews), 뉴스 클러스터(Newsis 등), LF(Daum)"],
  ["Brand", "26", "thisisneverthat(+Hypebeast), Covernat(+IG/YT), Mahagrid(+IG), Glowny, Matin Kim, COS(Odalisque/WWW), Uniqlo(LOfficiel), Andersson Bell"],
  ["Community", "18", "luzien2/dongseox/trace0426 tistory, Naver blog x4, GQ Korea, Vogue Korea knit, Threads, YouTube x4, stay.enko, Reddit(차단—snippet)"],
]
story += [P("family 별 레코드 수와 대표 소스:", "quiet"),
  data_table(["Family", "Records", "대표 소스"], fam_rows, [58, 48, W - 2 * M - 106]),
  Spacer(1, 8),
  P("차단/불가 소스도 기록했다: W Concept(404/JS), 29CM 랭킹(404/timeout), SSF·LF Mall(JS), Zara(자동화 차단), "
    "Reddit r/KoreanFashion(검색 결과 없음), Instagram·TikTok(로그인 월 — snippet만). 전체 목록은 "
    "N1_TREND_EVIDENCE/N1_TREND_EVIDENCE.json source_registry 참조.", "quiet"),
  PageBreak(),
]

# ── 05 TARGET CUSTOMER ──
story += section_head("05", "TARGET CUSTOMER", "20대 ~ 30초반, 한국")
story += [
  P("· 구매 시즌: 지금(9월)은 간절기 — 니트/셔츠/얇은 아우터가 1차 수요, 11월부터 기모·코트로 이동. "
    "RC 카탈로그는 간절기→초겨울(기모 일부)까지를 커버한다."),
  P("· 가격대: 무신사스탠다드 기준 톱 레인지 2~4만원대가 이 층의 저항선. N°1 판매가 평균 약 3.3만원, "
    "세트(코디) 기준 4~9만원이 주 밴드 — 세트 기준 가격이 '부담 없는 한 벌' 독스 기준과 겹친다."),
  P("· 성별 표현: 남성 실루엣은 오버사이즈 피로감이 언급되며 슬림 회귀 서사가 에디토리얼에서 시작됨. "
    "여성은 스키니/시가렛 회귀 서사와 세미와이드의 공존(전환기). 젠더리스는 베이스 캐주얼에서 수요가 확인된다."),
  P("· 라이프스타일: 오피스 캐주얼(셔츠+슬랙스), 캠퍼스/데일리(니트+데님), 데이트(브라운 계열 톤온톤) — "
    "커뮤니티 소스에서 반복되는 3대 상황축을 페어 이유문에 반영."),
  PageBreak(),
]

# ── 06 KEY TREND CLUSTERS ──
story += section_head("06", "KEY TREND CLUSTERS", "T01 ~ T10")
cluster_rows = []
for cid in ["T01", "T02", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T03"]:
    c = ev["clusters"][cid]
    cluster_rows.append([cid, c["name"], c["confidence"].replace(" — RC 스코프 제외", "\n(RC 제외)"), c["statement"][:118] + ("…" if len(c["statement"]) > 118 else "")])
story += [data_table(["ID", "클러스터", "신뢰도", "근거 요지"], cluster_rows,
                     [30, 118, 58, W - 2 * M - 206]),
          Spacer(1, 8),
          P("LOW 신뢰 관찰(스칸트/발레코어 2025판, 부츠컷 스니펫 미확인 등)은 카탈로그 core에 넣지 않았다(§13). "
            "각 클러스터의 레코드 단위 근거는 N1_TREND_EVIDENCE.json 참조.", "quiet"),
          PageBreak()]

# ── 07-09 MEN / WOMEN / GENDERLESS ──
def gender_section(num, label, g, note):
    rows = [[p["product_id"], p["name"], f"{p['retail']:,}", "·".join(p["cluster_ids"]) or "베이스"]
            for p in cat["catalog"] if p["gender"] == g]
    return section_head(num, label.upper(), f"{label} — {sum(1 for p in cat['catalog'] if p['gender']==g)} pieces") + [
            P(note, "quiet"),
            data_table(["ID", "상품명", "판매가", "클러스터"], rows, [62, 210, 62, W - 2 * M - 334]),
            PageBreak()]

story += gender_section("07", "MEN", "MALE",
  "슬림·스트레이트 회귀(T01)와 니트 퍼스트(T02)를 축으로, 워싱 데님과 기모를 간절기→초겨울 bridge로 배치했다. "
  "카키·브라운·핑크체크로 포인트를 분산해 올블랙 과밀을 피했다.")
story += gender_section("08", "WOMEN", "FEMALE",
  "브이넥 니트 중심 탑(T02)에 부츠컷 데님·미디 스커트(T01·T10)를 대응. 코듀로이·체크로 텍스처 다양성을 확보하고 "
  "가격 밴드를 9,600~43,900원으로 넓게 깔았다.")
story += gender_section("09", "GENDERLESS", "GENDERLESS",
  "가디건·셔츠·맨투맨의 베이스 축과 와이드·밴딩 하의. 도매 풀 특성상 스웨트셔츠 비중이 높아 "
  "서브타입 캡(동일 타입 ≤2)으로 과밀을 제어했다.")

# ── 10 TOPS / 11 BOTTOMS ──
def tb_section(num, label, role):
    rows = [[p["product_id"], KO(p["gender"]), p["name"], f"{p['retail']:,}"]
            for p in cat["catalog"] if p["top_bottom"] == role]
    return section_head(num, label.upper(), f"{label} {len(rows)} pieces") + [
            data_table(["ID", "성별", "상품명", "판매가"], rows, [62, 48, 250, W - 2 * M - 360]),
            PageBreak()]
story += tb_section("10", "TOPS", "의류-상의")
story += tb_section("11", "BOTTOMS", "의류-하의")

# ── 12 STYLING PATTERNS ──
story += section_head("12", "TOP × BOTTOM STYLING PATTERNS", "근거 기반 코디 패턴")
story += [
  P("① 니트 × 데님 — T02의 기본 공식. 하프집업·브이넥에 스트레이트/부츠컷 데님. 커뮤니티+에디토리얼+브랜드 3축 공통.", "quiet"),
  P("② 셔츠 × 슬랙스 — T06 오피스 축. 카라 노출 레이어링까지 포함하는 정돈된 조합.", "quiet"),
  P("③ 오버핏 탑 × 일자 하의 — §41 'compact top + relaxed bottom' 반복 관찰의 반대 방향 응용. 실루엣 균형 20점 만점 축.", "quiet"),
  P("④ 기모 × 코듀로이/기모 — 초겨울 보온 조합(T08). 11월 전환 대비.", "quiet"),
  P("⑤ 톤온톤 브라운 — T04. 카멜/브라운 니트+코듀로이 등 컬러 수렴이 가장 강한 축.", "quiet"),
  PageBreak(),
]

# ── 13 SOURCING CRITERIA ──
story += section_head("13", "WHOLESALE SOURCING CRITERIA", "도매 소싱 기준")
story += [
  P("· 경로: 도매꾹 OpenAPI getItemList ver 4.1 (공급 품절 상품은 응답에서 제외되는 검증된 계약)."),
  P("· 가격 밴드: 도매가 4,000~45,000원 — 판매가 환산 7,600~85,500원. 초저가 땡처리/이벤트성 배제."),
  P("· 스코프: TOP×BOTTOM 전용. 블루종·코트·패딩 등 아우터와 원피스·세트는 분류 단계에서 제외."),
  P("· 혼재 타이틀 제외: 상·하의 키워드가 동시에 섞인 공급사 제목은 제품 주체 판별 불가로 정직하게 제외."),
  P("· 데이터 규율(§22): 공급 페이지가 고시(소재/세탁/제조자)를 JS 렌더링하는 관계로 미확인 필드는 전부 UNKNOWN. "
    "색상은 공급사 타이틀 명시 토큰만. 옵션별재고 미확정 — 구매 버튼은 '재고 확인 후' 정직 상태 유지."),
  P("· 중복 제거(§25): 한글 토큰 Jaccard + SequenceMatcher 0.6 이상 + 동일 역할/성별에서 canonical 그룹화, 1,717 → 725 그룹."),
  PageBreak(),
]

# ── 14 SELECTED CANDIDATES ──
story += section_head("14", "SELECTED PRODUCT CANDIDATES", "선별 44건 — 추적 가능")
rows = [[p["product_id"], p["name"], KO(p["gender"]), "상의" if p["top_bottom"].endswith("상의") else "하의",
         f"{p['cost']:,}", f"{p['retail']:,}", p["source_product_id"]]
        for p in cat["catalog"]]
story += [data_table(["ID", "상품명", "성별", "구분", "도매", "판매", "공급사코드"], rows,
                     [58, 168, 38, 32, 44, 46, W - 2 * M - 386]),
          Spacer(1, 6),
          P("매입가 합계 760,850원 / 판매가 합계 1,445,600원. 선별 스코어(TREND 40·DATA 20·MARGIN 20·VERSATILITY 20)와 "
            "감사 필드는 N1_PRODUCT_SELECTION_AUDIT/candidate_audit.json 참조.", "quiet"),
          PageBreak(),
]

# ── 15 REJECTED / EXCLUDED ──
story += section_head("15", "REJECTED / EXCLUDED", "제외 사유가 기록된 사례")
story += [
  P("· 스웨이드/레더 블루종 — 가장 강한 아우터 트렌드(29CM +124%)이나 페어 모델 스코프 밖. 후속 아우터 라인 최우선 후보.", "quiet"),
  P("· 원피스·세트업 — 단독 완결형이라 TOP×BOTTOM 코디 전시와 충돌. 제외.", "quiet"),
  P("· 하객룩/포멀 — P1에서 동일 특성으로 거절된 이력(P1_REJECTED_TRAITS) 재발 방지.", "quiet"),
  P("· 5천원 미만 초저가/땡처리 — 브랜드 가치 훼손과 품질 리스크. 108건 가격 밴드 필터 아웃.", "quiet"),
  P("· 키즈·홈웨어·속옷·액세서리 — 카테고리 스코프 백.", "quiet"),
  P("· generic 명칭 상품(니트/셔츠 단일어) — 정확성은 유지하되 publish 전 네이밍 정제 과제로 HERMES 운영노트에 기록됨.", "quiet"),
  PageBreak(),
]

# ── 16 PAIRING LOGIC ──
story += section_head("16", "PAIRING LOGIC", "N1 OUTFIT PAIRING POLICY V1 — 요지")
story += [
  P("8축 100점 — TREND 20 / COLOR 20 / SILHOUETTE 20 / MATERIAL 15 / OCCASION 10 / PRICE 5 / DATA 5 / "
    "DIVERSITY(matching). UNKNOWN은 가점·감점 없는 중간값(§44). 스코어는 내부 머천다이징 랭킹이며 고객 노출 금지(§40)."),
  P("매칭은 스코프별 최대가중 1:1 전수 탐색(≤8×8 정확해), 플로어 68 미달 페어 강제 금지 — 스코프당 미매칭 최대 4개 허용(HERMES 정정)."),
  Spacer(1, 6),
]
pair_rows = [[p["pair_id"], p["scope_label"], p["top_name"], p["bottom_name"], str(p["pair_score_internal"]), p["tier"].replace("_", " ")]
             for p in prs["pairs"]]
story += [data_table(["pair", "스코프", "TOP", "BOTTOM", "score", "tier"], pair_rows,
                     [64, 40, 128, 128, 36, W - 2 * M - 396]),
          Spacer(1, 6),
          P("미매칭 4개(여T 피그먼트 오버핏 맨투맨·피그먼트 셔츠, 여B 밴딩 미디 스커트·스커트)와 "
            "BELOW 3쌍은 조용한 '단품으로 보기' 영역만 노출. pair_reason_short은 관측 근거만 서술.", "quiet"),
          PageBreak(),
]

# ── 17 RISK / LIMITATIONS ──
story += section_head("17", "RISK / LIMITATIONS", "한계 — 정직한 목록")
story += [
  P("· 소재·세탁·제조자 고시 미확인(UNKNOWN) — 공급 페이지 JS 렌더링 탓에 정적 수집 불가. 전자상거래 고시 관점에서 "
    "publish 전 Owner/HERMES의 옵션·고시 확정(기존 게이트#2)이 필요하다."),
  P("· 이미지 — 전 상품 image_status=SOURCE_ONLY(공급사 제품컷). N°1 자체 이미지 생성은 별도 승인 미션(§81). "
    "FASHN/GPT Image는 호출·크레딧 소진 0건."),
  P("· 리서치 한계 — 인스타그램·틱톡 본문 접근 불가(snippet만), Reddit 회수 실패. 커뮤니티 축은 블로그/유튜브 메타데이터가 대리. "
    "수요 수치는 29CM 거래 데이터 등 관측분만 사용."),
  P("· 젠더리스 풀 — 도매 단일 풀 특성상 스웨트셔츠 비중이 높음. 서브타입 캡으로 완화했으나 V2에서 풀 다변화 권장."),
  P("· PairScore — 주문 데이터 0건 상태의 머천다이징 휴리스틱. 판매 데이터 축적 후 재보정 필요(§84 cadence)."),
  PageBreak(),
]

# ── 18 SOURCE INDEX ──
story += section_head("18", "SOURCE INDEX", "소스 색인 — 전체 57곳")
src_rows = [[str(i + 1), s["source_name"] or "", s.get("publication_date") or "—", (s["url"] or "")[:86]]
            for i, s in enumerate(ev["source_registry"])]
story += [data_table(["#", "소스", "발행", "URL"], src_rows, [22, 150, 56, W - 2 * M - 228]),
          Spacer(1, 8),
          P("아티팩트 번들: N1_TREND_EVIDENCE.json(73레코드) · N1_SOURCE_REGISTRY · candidate_audit.json · "
            "catalog_selected.json · pairing_results.json · N1_PAIRING_POLICY_V1.md · N1_IMAGE_GENERATION_QUEUE.json · "
            "N1_MASTER_DB_SNAPSHOT(스왑 이전 전체 백업).  — N°1, 2026-09-09", "quiet")]

doc.build(story)
print("PDF built:", OUT, os.path.getsize(OUT), "bytes")
`;

const pyFile = "generate_report_src.py";
require("fs").writeFileSync(pyFile, PY);
try {
  execFileSync("python", [pyFile], { stdio: "inherit", cwd: __dirname });
} finally {
  require("fs").unlinkSync(pyFile);
}
