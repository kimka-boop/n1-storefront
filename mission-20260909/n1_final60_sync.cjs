#!/usr/bin/env node
/**
 * N1 FINAL CATALOG 60 — STAGE + SWAP (2026-09-10)
 * 실행 위치: mission-20260909/   env: ../.env.local
 *
 * --stage : final_60_catalog.json → MASTER_DB_NEXT_20260910 탭 신설(60행) + READBACK 검증
 * --swap  : Products 현행(44) → 백업_PRODUCTS_20260910 백업 후
 *           MASTER_DB_NEXT_20260910(60행)을 Products로 이관(live 스키마 유지) + 성별 뷰 재구성
 * --rollback : 백업_PRODUCTS_20260910 → Products 복원
 *
 * 불변 탭: Orders / Orders_CS / Users / Refunds / Customer 일체 (§3 계약 유지)
 */
process.loadEnvFile("../.env.local");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");
const fs = require("fs");

const STAGING_TAB = "MASTER_DB_NEXT_20260910";
const BACKUP_TAB = "백업_PRODUCTS_20260910";
const GENDER_TABS = { MALE: "남성", FEMALE: "여성", GENDERLESS: "젠더리스" };
const CATALOG_JSON = "final_60_catalog.json";

const LIVE_HEADERS = [
  "상품ID", "상품명", "성별", "카테고리", "공급사명", "공급사코드", "공급사URL",
  "매입가", "판매가", "마진율", "재고상태", "룩북상태", "갱신일", "룩북이미지URL",
  "소재", "세탁정보", "실측사이즈", "모델정보", "두께감", "신축성", "비침", "안감", "핏감",
  "원산지", "제조자", "제조연월", "색상옵션", "사이즈옵션", "옵션별재고",
  "fit_profile", "unisex_score",
  "raw_product_name", "trend_cluster_ids", "trend_evidence_ids",
  "selection_score", "selection_reason_internal", "pair_ready", "image_status", "publish_ready", "audit_status",
];
const STAGING_ONLY = new Set(LIVE_HEADERS.slice(31));

const str = (v) => String(v ?? "").trim();
const today = "2026-09-10";

function catalogToRow(it) {
  return {
    "상품ID": str(it.product_id),
    "상품명": str(it.name),
    "성별": str(it.gender),
    "카테고리": str(it.top_bottom),
    "공급사명": str(it.source_site || "도매꾹"),
    "공급사코드": str(it.source_product_id),
    "공급사URL": str(it.source_url),
    "매입가": str(it.cost),
    "판매가": str(it.retail),
    "마진율": str(it.margin_pct ?? ""),
    "재고상태": "판매중",
    "룩북상태": "대기",
    "갱신일": today,
    "룩북이미지URL": str(it.source_image),
    "소재": str(it.material) || "UNKNOWN",
    "세탁정보": str(it.care) || "UNKNOWN",
    "실측사이즈": "UNKNOWN",
    "모델정보": "UNKNOWN",
    "두께감": "UNKNOWN", "신축성": "UNKNOWN", "비침": "UNKNOWN", "안감": "UNKNOWN", "핏감": "UNKNOWN",
    "원산지": str(it.origin) || "UNKNOWN",
    "제조자": str(it.manufacturer) || "UNKNOWN",
    "제조연월": str(it.madeAt) || "UNKNOWN",
    "색상옵션": Array.isArray(it.colors) ? it.colors.join(", ") : str(it.colors),
    "사이즈옵션": Array.isArray(it.sizes) ? it.sizes.join(", ") : str(it.sizes),
    "옵션별재고": "",
    "fit_profile": "", "unisex_score": "",
    "raw_product_name": str(it.raw_name),
    "trend_cluster_ids": Array.isArray(it.cluster_ids) ? it.cluster_ids.join(",") : str(it.cluster_ids),
    "trend_evidence_ids": Array.isArray(it.trend_evidence_ids) ? it.trend_evidence_ids.join(",") : "",
    "selection_score": str(it.selection_score ?? ""),
    "selection_reason_internal": str(it.selection_reason_internal),
    "pair_ready": "UNKNOWN",
    "image_status": "SOURCE_ONLY",
    "publish_ready": "PENDING_OWNER",
    "audit_status": "STAGED_20260910",
  };
}

(async () => {
  const mode = ["--stage", "--swap", "--rollback"].find((m) => process.argv.includes(m)) || "";
  if (!mode) { console.error("usage: node n1_final60_sync.cjs --stage | --swap | --rollback"); process.exit(1); }
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();

  const readAll = async (sheet) => {
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    return { headers: sheet.headerValues, rows: rows.map((r) => {
      const o = {};
      for (const h of sheet.headerValues) o[h] = str(r.get(h));
      return o;
    }) };
  };

  async function ensureTabFrom(tabTitle, headers, rows) {
    const existing = doc.sheetsByTitle[tabTitle];
    if (existing) await doc.deleteSheet(existing.sheetId);
    const s = await doc.addSheet({ title: tabTitle });
    await rawResize(auth, s.sheetId, Math.max(rows.length + 1, 2), Math.max(headers.length, 2));
    await new Promise((r) => setTimeout(r, 800));
    await doc.loadInfo();
    const fresh = doc.sheetsByTitle[tabTitle];
    await fresh.setHeaderRow(headers);
    if (rows.length) await fresh.addRows(rows);
    return fresh;
  }

  if (mode === "--stage") {
    const data = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf-8"));
    if (data.count !== 60) throw new Error("catalog count " + data.count + " != 60");
    const dist = {};
    for (const it of data.catalog) {
      const k = it.gender + "-" + (it.top_bottom === "의류-상의" ? "TOP" : "BOTTOM");
      dist[k] = (dist[k] || 0) + 1;
    }
    for (const k of Object.keys(dist)) if (dist[k] !== 10) throw new Error("segment " + k + " = " + dist[k] + " != 10");
    const rows = data.catalog.map(catalogToRow);
    await ensureTabFrom(STAGING_TAB, LIVE_HEADERS, rows);
    // READBACK 검증
    await doc.loadInfo();
    const st = doc.sheetsByTitle[STAGING_TAB];
    const back = await readAll(st);
    if (back.rows.length !== 60) throw new Error("readback rows " + back.rows.length);
    const ids = back.rows.map((r) => r["상품ID"]);
    if (new Set(ids).size !== 60) throw new Error("duplicate 상품ID");
    const missing = back.rows.filter((r) => !r["상품명"] || !r["공급사코드"] || !r["판매가"] || !r["공급사URL"]);
    if (missing.length) throw new Error("required-field gaps: " + missing.map((r) => r["상품ID"]).join(","));
    const segs = {};
    for (const r of back.rows) {
      const k = r["성별"] + "-" + (r["카테고리"] === "의류-상의" ? "TOP" : "BOTTOM");
      segs[k] = (segs[k] || 0) + 1;
    }
    console.log("STAGE OK: 60 rows | dist", JSON.stringify(segs), "| required-field gaps 0 | dup 0");
  } else if (mode === "--swap") {
    const products = doc.sheetsByTitle["Products"];
    const current = await readAll(products);
    // 1) 백업
    await ensureTabFrom(BACKUP_TAB, current.headers, current.rows);
    console.log("backup:", BACKUP_TAB, "<-", current.rows.length, "rows");
    // 2) 스테이징 readback
    const st = doc.sheetsByTitle[STAGING_TAB];
    if (!st) throw new Error("no staging tab — run --stage first");
    const next = await readAll(st);
    if (next.rows.length !== 60) throw new Error("staging rows " + next.rows.length);
    // 3) Products 원자적 교체 (index 0 계약 유지)
    if (current.rows.length) await products.clearRows();
    await new Promise((r) => setTimeout(r, 400));
    const compact = next.rows.map((r) => {
      const o = {};
      for (const h of current.headers) o[h] = r[h] ?? "";
      return o;
    });
    await products.addRows(compact);
    console.log("swap: Products <-", compact.length, "rows (staging", next.headers.length, "cols -> live", current.headers.length, "cols)");
    // 4) 성별 뷰 재구성
    for (const g of Object.keys(GENDER_TABS)) {
      const view = {
        headers: current.headers,
        rows: compact.filter((r) => r["성별"] === g),
      };
      await ensureTabFrom(GENDER_TABS[g], view.headers, view.rows);
      console.log("view:", GENDER_TABS[g], "<-", view.rows.length);
    }
  } else {
    const backup = doc.sheetsByTitle[BACKUP_TAB];
    if (!backup) throw new Error("no backup tab");
    const saved = await readAll(backup);
    const products = doc.sheetsByTitle["Products"];
    await products.clearRows();
    await new Promise((r) => setTimeout(r, 400));
    const rows = saved.rows.map((r) => { const o = {}; for (const h of saved.headers) o[h] = r[h] ?? ""; return o; });
    await products.addRows(rows);
    console.log("rollback: Products <-", rows.length, "rows from", BACKUP_TAB);
  }
  const p = doc.sheetsByTitle["Products"];
  const after = await readAll(p);
  console.log("verify: Products", after.rows.length, "rows, index=" + p.index, "sample=", after.rows[0] ? after.rows[0]["상품ID"] + " / " + after.rows[0]["상품명"] : "(empty)");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

async function rawResize(auth, sheetId, rowCount, columnCount) {
  await auth.authorize();
  const token = auth.credentials.access_token;
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + process.env.N1_SHEET_ID + ":batchUpdate", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount, columnCount } }, fields: "gridProperties(rowCount,columnCount)" } }] }),
  });
  if (!res.ok) throw new Error("resize fail " + res.status);
}
