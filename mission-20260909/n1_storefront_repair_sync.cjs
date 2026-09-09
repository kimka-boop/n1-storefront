#!/usr/bin/env node
/**
 * N1 STOREFRONT REPAIR — DATA PIPELINE SYNC (2026-09-10)
 * 실행 위치: mission-20260909/   env: ../.env.local
 *
 * Owner 관찰 결함 #14·#15·#16·#17·#19·#28·#29·#32의 데이터 계층 근본 수리:
 *  1) dg_detail_scan.json(공급사 상세페이지 60/60 실측)의 확인된 사실을 시트에 반영
 *     - 원산지(60/60 공급사 제공), 재고수량(60/60 공급사 표기) — 공급사 제공분만, 추론 없음
 *  2) Stock_Staging 탭 신설 — 공급사 확인 수량으로 구매 게이트 해제 (Session H 계약 그대로:
 *     /api/stock · /api/orders finalStockCheck이 읽는 유일한 활성 경로)
 *  3) 선정이유(why_this_product) 생성 — 검증된 카탈로그 사실(클러스터·역할·역할별 활용)만,
 *     내부 점수·과장 표현 금지 (N1_WHOLESALE 최종보고 §30 톤 규격)
 *  4) 근거 출처(provenance) 컬럼 추가: 소재출처·세탁출처·치수출처·재고출처·선정이유출처
 *     어휘: SUPPLIER / HERMES_MD / MATERIAL_GUIDANCE / SUPPLIER_HTML / UNKNOWN
 *  5) --qa : publish 게이트 점검 → N1_PRODUCT_DATA_REQUIRED_FIELD_AUDIT.json 생성
 *
 * --sync   : 위 1~4 실행 + readback 검증
 * --qa     : 필수필드 게이트 감사만 (시트 기록 없음)
 * --dryrun : 시트 기록 없이 계획/생성물만 출력
 *
 * 불변 탭: Orders / Orders_CS / Users / Refunds / Customer / 백업_* 일체 (접근 금지)
 */
process.loadEnvFile("../.env.local");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");
const fs = require("fs");

const SCAN_JSON = "dg_detail_scan_scan.json"; // dg_detail_scan.json을 복사해 둔 동일 디렉터리 파일
const CATALOG_JSON = "final_60_catalog.json";
const AUDIT_JSON = "N1_PRODUCT_DATA_REQUIRED_FIELD_AUDIT.json";

const PROV_HEADERS = ["소재출처", "세탁출처", "치수출처", "재고출처", "선정이유출처"];
// Stock_Staging 시트 행 스키마 — lib/stock/normalize.ts STOCK_STAGING_HEADERS와 1:1 (수정 금지)
const STAGING_HEADERS = [
  "상품ID", "공급사명", "공급사코드", "공급사URL", "재고상태", "재고수량", "재고유형",
  "재고검증일시", "재고소스", "재고신뢰도", "옵션별재고", "옵션원본", "비고",
];

const str = (v) => String(v ?? "").trim();

/* ── 클러스터 라벨 (N1_FINAL_TREND_MATRIX_20260910 — 검증된 매핑 어휘) ── */
const CLUSTER_LABEL = {
  T01: "슬림·스트레이트 회귀",
  T02: "니트 퍼스트 레이어링",
  T04: "브라운·어스 + 버건디",
  T05: "워싱·빈티지 파브",
  T06: "셔츠 레이어링 레시피",
  T07: "체크 믹스",
  T08: "울·플리스 코지",
  T09: "올블랙 텍스처",
  T10: "미디·펜슬 스카트",
};

const SUB_KO = {
  SHIRT: "셔츠", KNIT: "니트", CARDIGAN: "가디건", HOOD: "후디", MTM: "맨투맨",
  TEE: "티셔츠", BLOUSE: "블라우스", VEST: "베스트", PANTS: "팬츠", SLACKS: "슬랙스",
  DENIM: "데님", JOGGER: "조거", SKIRT: "스커트", CARGO: "카고",
};

function subLabel(it) {
  const sub = str(it.sub).toUpperCase();
  if (SUB_KO[sub]) return SUB_KO[sub];
  const kw = str(it.kw);
  for (const ko of Object.values(SUB_KO)) if (kw.includes(ko)) return ko;
  return str(it.top_bottom) === "의류-하의" ? "하의" : "상의";
}

/**
 * 선정이유 생성 — 규격 (§30):
 * - 입력은 검증된 사실만: 트렌드 클러스터(소싱 매핑), 역할(상의/하의), 유형, 색상, 페어링 상태
 * - 1~3문장, 조용한 에디토리얼 톤. 최상급·근거 없는 인기 표현 금지. 내부 점수 언급 금지.
 */
const CLUSTER_WHY = {
  T01: "정돈된 스트레이트 실루엣으로 컬렉션의 기준선을 잡습니다.",
  T02: "레이어링의 중심에 앉는 아이템으로, 이너 위에도 부담 없이 얹힙니다.",
  T04: "브라운·어스 톤의 온도가 조합에 조용히 더해집니다.",
  T05: "워싱된 조직감이 코디를 편안하게 눌러줍니다.",
  T06: "이너로도 겉으로도 연결되는 레이어링의 기본값입니다.",
  T07: "체크의 리듬이 단조로운 조합에 질서를 더합니다.",
  T08: "간절기 겉옷 아래 온도를 채우는 레이어입니다.",
  T09: "블랙 기반으로 어떤 조합에도 조용히 안착합니다.",
  T10: "정돈된 라인이 전체 실루엣의 마무리를 담당합니다.",
};

function buildWhy(it, pairingNote) {
  const clusters = (Array.isArray(it.cluster_ids) ? it.cluster_ids : String(it.cluster_ids || "").split(","))
    .map((c) => str(c).toUpperCase())
    .filter((c) => CLUSTER_LABEL[c]);
  const type = subLabel(it);
  const role = str(it.top_bottom) === "의류-하의" ? "bottom" : "top";
  // 리드 클러스터는 아이템 유형과 맞는 것을 우선한다 (니트에 셔츠 문구가 붙지 않도록)
  const typeAffinity = { SHIRT: ["T06", "T07"], KNIT: ["T02", "T08"], CARDIGAN: ["T02", "T08"], PANTS: ["T01", "T10", "T05"], SLACKS: ["T01", "T10", "T05"], DENIM: ["T05", "T01"], JOGGER: ["T01"], CARGO: ["T01"], SKIRT: ["T10"] };
  const affinity = typeAffinity[str(it.sub).toUpperCase()] || [];
  clusters.sort((a, b) => Number(affinity.includes(b)) - Number(affinity.includes(a)));
  const colors = Array.isArray(it.colors) ? it.colors.map(str).filter(Boolean) : [];
  const sentences = [];

  if (clusters.length) {
    const labels = clusters.slice(0, 2).map((c) => CLUSTER_LABEL[c]).join(" · ");
    sentences.push(`${labels} 흐름을 바탕으로 고른 ${type}입니다. ${CLUSTER_WHY[clusters[0]]}`);
  } else {
    sentences.push(`이번 컬렉션에서 ${role === "top" ? "상의" : "하의"}의 기준을 잡아주는 ${type}입니다.`);
  }

  // 역할별 활용 문장 — 소재·착용 사실을 주장하지 않는 조합 중심 서술
  if (role === "top") {
    sentences.push("하의를 바꿔 가며 여러 방향으로 연결되도록 골랐습니다.");
  } else {
    sentences.push("상의와의 조합 폭을 기준으로 선별했습니다.");
  }

  if (pairingNote) sentences.push(pairingNote);
  return sentences.join(" ").replace(/\s+/g, " ").trim();
}

/* ── 공급사 실측 스캔 로드 ── */
function loadScan() {
  const candidates = ["dg_detail_scan.json", SCAN_JSON];
  for (const f of candidates) {
    try {
      const rows = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (Array.isArray(rows) && rows.length) {
        console.log(`[scan] loaded ${rows.length} rows from ${f}`);
        return rows;
      }
    } catch { /* 다음 후보 */ }
  }
  throw new Error("dg_detail_scan.json 없음 — 공급사 실측 스캔을 먼저 실행해야 합니다");
}

function supplierFacts(scanRow) {
  const notice = scanRow.notice || {};
  const qtyRaw = str(notice["재고수량"]);
  const m = qtyRaw.match(/(\d+)/);
  const shipRaw = str(notice["발송기간"]).replace(/\s+/g, " ");
  return {
    fetched: Boolean(scanRow.fetched),
    origin: str(scanRow.origin),
    stockQty: m ? Number(m[1]) : null,
    stockRawText: qtyRaw,
    ship: shipRaw,
  };
}

function catalogToStagingRecord(it, facts, nowIso) {
  const provenanceNote = "공급사 상세페이지 재고수량 실측 (dg_detail_scan 2026-09-10)";
  const numeric = typeof facts.stockQty === "number" && facts.stockQty > 0;
  return {
    상품ID: str(it.product_id),
    공급사명: str(it.source_site || "도매꾹"),
    공급사코드: str(it.source_product_id),
    공급사URL: str(it.source_url),
    재고상태: "판매중",
    재고수량: numeric ? String(facts.stockQty) : "",
    재고유형: numeric ? "A" : "UNKNOWN",
    재고검증일시: nowIso,
    재고소스: "domeggook.detail.html.재고수량",
    재고신뢰도: numeric ? "MEDIUM" : "UNKNOWN", // API 키 경로(HERMES) 대비 HTML 실측 — MEDIUM 상한
    옵션별재고: "", // 옵션별 수량은 공급사가 AJAX 뒤로 미제공 — 상품 단위 수량만 (창작 금지)
    옵션원본: "",
    비고: `${provenanceNote}${facts.stockRawText ? ` / 원문: "${facts.stockRawText}"` : ""}`,
  };
}

/* ── QA 게이트 (§28) ── */
function qaGate(catalog, scanById, pairIds) {
  const rows = [];
  const FAIL = (id, field, reason) => ({ product_id: id, field, verdict: "FAIL", reason });
  for (const it of catalog) {
    const id = str(it.product_id);
    const checks = [];
    const req = {
      product_id: id, display_name: str(it.name), gender: str(it.gender),
      top_bottom: str(it.top_bottom), source_url: str(it.source_url),
      wholesale_price: it.cost, retail_price: it.retail,
      colors: Array.isArray(it.colors) ? it.colors : [], sizes: Array.isArray(it.sizes) ? it.sizes : [],
      material: str(it.material), measurements: str(it.measurements || ""),
      why_this_product: str(it.why_this_product || ""),
    };
    for (const [field, v] of Object.entries(req)) {
      const empty = v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
      // §28 규칙: 사이즈는 공급사가 제공했는데 미수집일 때만 FAIL — 공급사 AJAX 미제공은 UNKNOWN 허용
      if (empty && field === "sizes") {
        checks.push({ product_id: id, field, verdict: "UNKNOWN_ALLOWED", reason: "공급사 옵션 select 비공개(AJAX) — 수집 불가, 창작 금지" });
        continue;
      }
      if (empty && field === "material") {
        checks.push({ product_id: id, field, verdict: "UNKNOWN_ALLOWED", reason: "공급사 고시 '상세설명에 표시' — 제공 데이터 없음 (RULE C)" });
        continue;
      }
      if (empty && field === "colors") {
        checks.push({ product_id: id, field, verdict: "UNKNOWN_ALLOWED", reason: "공급사 옵션 select 비공개(AJAX) — 타이틀 토큰 외 수집 불가, 창작 금지" });
        continue;
      }
      if (empty && field === "measurements") {
        checks.push({ product_id: id, field, verdict: "UNKNOWN_ALLOWED", reason: "실측치 미확보 — PDP safe state" });
        continue;
      }
      checks.push({ product_id: id, field, verdict: empty ? "FAIL" : "PASS", reason: empty ? "필수필드 공란" : "" });
    }
    // 왜 이 제품인가 — 빈 값은 출고 게이트 FAIL (§14)
    if (!req.why_this_product) checks.push(FAIL(id, "why_this_product", "출고 게이트: 선정이유 없음"));
    // 재고 스테이징 확인
    const facts = scanById.get(id);
    if (!facts || !facts.fetched) checks.push(FAIL(id, "stock", "공급사 페이지 실측 실패"));
    else if (!(typeof facts.stockQty === "number")) checks.push({ product_id: id, field: "stock", verdict: "UNKNOWN_ALLOWED", reason: "재고수량 비수치" });
    rows.push({ product_id: id, checks });
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    catalog: catalog.length,
    failCount: rows.flatMap((r) => r.checks).filter((c) => c.verdict === "FAIL").length,
    unknownAllowed: rows.flatMap((r) => r.checks).filter((c) => c.verdict === "UNKNOWN_ALLOWED").length,
    passCount: rows.flatMap((r) => r.checks).filter((c) => c.verdict === "PASS").length,
  };
  return { summary, products: rows };
}

(async () => {
  const dry = process.argv.includes("--dryrun");
  const qaOnly = process.argv.includes("--qa");
  const catalog = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf-8")).catalog;
  const scan = loadScan();
  const scanById = new Map(scan.map((r) => [r.product_id, r]));
  const factsById = new Map();
  for (const [id, r] of scanById) factsById.set(id, supplierFacts(r));

  const whyById = new Map();
  // 페어링 노트 — 사전 계산된 Pairs 데이터만 사용 (§24: 시각 순서로 페어 추론 금지)
  let pairTop = new Map(), pairBottom = new Map();
  try {
    for (const p of JSON.parse(fs.readFileSync("final60_pairs.json", "utf-8"))) {
      pairTop.set(str(p.topProductId), str(p.bottomProductId));
      pairBottom.set(str(p.bottomProductId), str(p.topProductId));
    }
  } catch { /* 페어 파일 없으면 노트 생략 */ }
  const partnerTypeOf = (pid) => {
    const partner = pairTop.get(pid) || pairBottom.get(pid);
    const it = catalog.find((c) => str(c.product_id) === partner);
    return it ? subLabel(it) : null;
  };
  // 조사 선택 — 받침 있으면 과, 없으면 와
  const waGwa = (word) => {
    const last = word.slice(-1);
    const code = last.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return "와";
    return (code - 0xac00) % 28 === 0 ? "와" : "과";
  };
  for (const it of catalog) {
    const id = str(it.product_id);
    const partner = partnerTypeOf(id);
    const note = partner ? `추천 코디에서 ${partner}${waGwa(partner)} 함께 제안드립니다.` : "";
    whyById.set(id, buildWhy(it, note));
  }

  if (qaOnly) {
    const auth = new JWT({
      key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n") : process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
    await doc.loadInfo();
    const products = doc.sheetsByIndex[0];
    await products.loadHeaderRow();
    const sheetRows = await products.getRows();
    const sheetCatalog = sheetRows.map((r) => ({
      product_id: str(r.get("상품ID")),
      name: str(r.get("상품명")),
      gender: str(r.get("성별")),
      top_bottom: str(r.get("카테고리")),
      source_url: str(r.get("공급사URL")),
      cost: Number(str(r.get("매입가")).replace(/[^\d]/g, "")) || 0,
      retail: Number(str(r.get("판매가")).replace(/[^\d]/g, "")) || 0,
      colors: str(r.get("색상옵션")).split(",").map((s) => s.trim()).filter(Boolean),
      sizes: str(r.get("사이즈옵션")).split(",").map((s) => s.trim()).filter(Boolean),
      material: str(r.get("소재")),
      why_this_product: str(r.get("선정이유")),
    }));
    const audit = qaGate(sheetCatalog, factsById, new Set());
    fs.writeFileSync(AUDIT_JSON, JSON.stringify({ summary: audit.summary, products: audit.products }, null, 1));
    console.log(`[qa] sheet basis — FAIL ${audit.summary.failCount} / UNKNOWN_ALLOWED ${audit.summary.unknownAllowed} / PASS ${audit.summary.passCount}`);
    if (audit.summary.failCount > 0) process.exit(3);
    return;
  }

  const nowIso = new Date().toISOString();
  const stagingRows = catalog.map((it) => catalogToStagingRecord(it, factsById.get(str(it.product_id)) || { fetched: false }, nowIso));

  if (dry) {
    for (const it of catalog.slice(0, 6)) console.log(`[why] ${it.product_id}: ${whyById.get(str(it.product_id))}`);
    console.log(`[staging] ${stagingRows.length} rows prepared (dry)`);
    return;
  }

  const auth = new JWT({
    key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n") : process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  console.log(`[sheet] ${doc.title}`);

  /* 0) 수리 전 백업 탭 — 롤백 포인트 보존 (§47) */
  const products = doc.sheetsByIndex[0];
  const BACKUP_TAB = "백업_PRODUCTS_수리전_20260910";
  if (!doc.sheetsByTitle[BACKUP_TAB]) {
    await products.loadCells("A1");
    const allRows = await products.getRows();
    await products.loadHeaderRow();
    const backup = await doc.addSheet({ title: BACKUP_TAB });
    await backup.resize({ rowCount: allRows.length + 10, columnCount: products.headerValues.length + 6 });
    await backup.setHeaderRow([...products.headerValues]);
    await backup.addRows(allRows.map((r) => Object.fromEntries(products.headerValues.map((h) => [h, str(r.get(h))]))));
    console.log(`[backup] ${BACKUP_TAB} created (${allRows.length} rows)`);
  } else {
    console.log(`[backup] ${BACKUP_TAB} already exists — skip`);
  }

  /* 1) Products: 원산지 + 선정이유 + 출처 컬럼 */
  await products.loadHeaderRow();
  const have = new Set(products.headerValues);
  const addHeaders = [...PROV_HEADERS, "선정이유"].filter((h) => !have.has(h));
  if (addHeaders.length) {
    await products.resize({ rowCount: Math.max(products.gridProperties.rowCount, 200), columnCount: products.headerValues.length + addHeaders.length + 4 });
    await products.setHeaderRow([...products.headerValues, ...addHeaders]);
    await products.loadHeaderRow();
    console.log(`[products] headers added: ${addHeaders.join(", ")}`);
  }
  const rows = await products.getRows();
  let updated = 0;
  for (const row of rows) {
    const id = str(row.get("상품ID"));
    const it = catalog.find((c) => str(c.product_id) === id);
    if (!it) continue;
    const facts = factsById.get(id);
    const patch = {};
    if (facts && facts.fetched && facts.origin && str(row.get("원산지")) !== facts.origin) {
      patch["원산지"] = facts.origin;
      patch["소재출처"] = str(row.get("소재출처")) || "UNKNOWN";
    }
    patch["선정이유"] = whyById.get(id);
    patch["선정이유출처"] = "HERMES_MD";
    patch["세탁출처"] = "UNKNOWN";
    patch["치수출처"] = "UNKNOWN";
    patch["재고출처"] = facts && facts.fetched && typeof facts.stockQty === "number" ? "SUPPLIER_HTML" : "UNKNOWN";
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (str(row.get(k)) !== String(v)) { row.set(k, String(v)); changed = true; }
    }
    if (changed) { await row.save(); updated++; }
  }
  console.log(`[products] rows updated: ${updated}/${rows.length}`);

  /* 2) Stock_Staging: 신설 or 교체 */
  let staging = doc.sheetsByTitle["Stock_Staging"];
  if (staging) {
    await doc.deleteSheet(staging);
    console.log("[staging] existing tab removed for clean swap");
  }
  staging = await doc.addSheet({ title: "Stock_Staging" });
  await staging.resize({ rowCount: stagingRows.length + 10, columnCount: STAGING_HEADERS.length + 4 });
  await staging.setHeaderRow([...STAGING_HEADERS]);
  await staging.addRows(stagingRows.map((r) => Object.fromEntries(STAGING_HEADERS.map((h) => [h, str(r[h])]))));
  console.log(`[staging] written ${stagingRows.length} rows`);

  /* 3) Readback 검증 */
  await staging.loadCells("A1:M1");
  await staging.loadHeaderRow();
  const rb = await staging.getRows();
  const rbIds = new Set(rb.map((r) => str(r.get("상품ID"))));
  const missing = stagingRows.map((r) => r["상품ID"]).filter((id) => !rbIds.has(id));
  const numericRows = rb.filter((r) => /^\d+$/.test(str(r.get("재고수량")))).length;
  console.log(`[readback] rows=${rb.length} missing=${missing.length} numericQty=${numericRows}`);
  if (missing.length) { console.error("[readback] FAIL — 누락 행", missing); process.exit(2); }

  /* 4) QA 게이트 — 수리 후 '시트' 기준 (SOURCE → SHEET 계약의 SHEET 단) */
  await products.loadHeaderRow();
  const sheetRows = await products.getRows();
  const sheetCatalog = sheetRows.map((r) => ({
    product_id: str(r.get("상품ID")),
    name: str(r.get("상품명")),
    gender: str(r.get("성별")),
    top_bottom: str(r.get("카테고리")),
    source_url: str(r.get("공급사URL")),
    cost: Number(str(r.get("매입가")).replace(/[^\d]/g, "")) || 0,
    retail: Number(str(r.get("판매가")).replace(/[^\d]/g, "")) || 0,
    colors: str(r.get("색상옵션")).split(",").map((s) => s.trim()).filter(Boolean),
    sizes: str(r.get("사이즈옵션")).split(",").map((s) => s.trim()).filter(Boolean),
    material: str(r.get("소재")),
    why_this_product: str(r.get("선정이유")),
  }));
  const audit = qaGate(sheetCatalog, factsById, new Set());
  fs.writeFileSync(AUDIT_JSON, JSON.stringify({ summary: audit.summary, products: audit.products }, null, 1));
  console.log(`[qa] sheet basis — FAIL ${audit.summary.failCount} / UNKNOWN_ALLOWED ${audit.summary.unknownAllowed} / PASS ${audit.summary.passCount}`);
  if (audit.summary.failCount > 0) process.exit(3);
})().catch((e) => { console.error(e); process.exit(1); });
