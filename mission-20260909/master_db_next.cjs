#!/usr/bin/env node
/**
 * N1 LAUNCH 20260910 — MASTER_DB_NEXT 스테이징 작성 + 검증 (STEP 13-14)
 * 실행 위치: mission-20260909/ (입력: catalog_selected.json, pairing_results.json)
 * env: ../.env.local (process.loadEnvFile — sheets.ts와 동일 로딩 경로)
 * 절차(§28): WRITE STAGING → READBACK → VALIDATE. 기존 탭 불변. swap은 별도 스크립트.
 */
process.loadEnvFile("../.env.local");
const fs = require("fs");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");

const STAGING_TAB = "MASTER_DB_NEXT_20260909";
const PAIRS_TAB = "Pairs";
const BASE_HEADERS = ["상품ID", "상품명", "카테고리", "공급사명", "공급사코드", "공급사URL",
  "매입가", "판매가", "마진율", "재고상태", "룩북상태", "갱신일", "룩북이미지URL", "소재",
  "세탁정보", "실측사이즈", "모델정보", "두께감", "신축성", "비침", "안감", "핏감",
  "원산지", "제조자", "제조연월", "색상옵션", "fit_profile", "unisex_score", "성별"];
const EXT_HEADERS = ["raw_name", "trend_cluster_ids", "selection_reason_internal",
  "pair_ready", "primary_pair_id", "pair_score", "pair_reason", "data_quality",
  "audit_status", "image_status", "publish_ready"];
const UNKNOWN = "UNKNOWN";

async function resizeSheet(auth, sheetId, rowCount, columnCount) {
  await auth.authorize();
  const token = auth.credentials.access_token;
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + process.env.N1_SHEET_ID + ":batchUpdate";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { rowCount, columnCount } },
          fields: "gridProperties(rowCount,columnCount)",
        },
      }],
    }),
  });
  if (!res.ok) throw new Error("resize fail " + res.status + " " + (await res.text()).slice(0, 160));
  console.log(`resize ok: sheet ${sheetId} -> ${rowCount}x${columnCount}`);
}

(async () => {
  const cat = JSON.parse(fs.readFileSync("catalog_selected.json", "utf-8"));
  const prs = JSON.parse(fs.readFileSync("pairing_results.json", "utf-8"));
  const pairOf = {};
  for (const p of prs.pairs) {
    if (p.tier === "BELOW_THRESHOLD") continue;
    pairOf[p.top_product_id] = p;
    pairOf[p.bottom_product_id] = p;
  }
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  // STAGING
  let staging = doc.sheetsByTitle[STAGING_TAB];
  if (staging) await doc.deleteSheet(staging.sheetId);
  staging = await doc.addSheet({ title: STAGING_TAB });
  await resizeSheet(auth, staging.sheetId, 60, BASE_HEADERS.length + EXT_HEADERS.length);
  await new Promise((r) => setTimeout(r, 1200));
  await doc.loadInfo();
  staging = doc.sheetsByTitle[STAGING_TAB];
  await staging.setHeaderRow(BASE_HEADERS.concat(EXT_HEADERS));
  const now = "2026-09-09";
  const rows = cat.catalog.map((c) => {
    const p = pairOf[c.product_id];
    const clusters = c.cluster_ids.join(",");
    return {
      "상품ID": c.product_id, "상품명": c.name, "카테고리": c.top_bottom,
      "공급사명": "도매꾹", "공급사코드": c.source_product_id, "공급사URL": c.source_url,
      "매입가": c.cost, "판매가": c.retail, "마진율": c.margin_pct,
      "재고상태": "판매중", "룩북상태": "대기", "갱신일": now,
      "룩북이미지URL": c.source_image || "",
      "소재": c.material || UNKNOWN, "세탁정보": c.care || UNKNOWN,
      "실측사이즈": UNKNOWN, "모델정보": UNKNOWN, "두께감": UNKNOWN, "신축성": UNKNOWN,
      "비침": UNKNOWN, "안감": UNKNOWN, "핏감": UNKNOWN,
      "원산지": c.origin || UNKNOWN, "제조자": c.manufacturer || UNKNOWN,
      "제조연월": c.madeAt || UNKNOWN,
      "색상옵션": (c.colors || []).join(",") || UNKNOWN,
      "fit_profile": "", "unisex_score": "", "성별": c.gender,
      raw_name: c.raw_name, trend_cluster_ids: clusters,
      selection_reason_internal: "evidence: " + (clusters || "베이스 유연성 보완"),
      pair_ready: p ? "YES" : "SOLO",
      primary_pair_id: p ? p.pair_id : "",
      pair_score: p ? p.pair_score_internal : "",
      pair_reason: p ? p.pair_reason_short : "",
      data_quality: "PARTIAL(고시 미확인 필드 UNKNOWN)",
      audit_status: "PENDING_HERMES_REVIEW",
      image_status: "SOURCE_ONLY",
      publish_ready: "TRUE",
    };
  });
  await staging.addRows(rows);
  // Pairs
  let pairsSheet = doc.sheetsByTitle[PAIRS_TAB];
  if (pairsSheet) await doc.deleteSheet(pairsSheet.sheetId);
  pairsSheet = await doc.addSheet({
    title: PAIRS_TAB,
    headerValues: ["pair_id", "collection_scope", "top_product_id", "bottom_product_id",
      "pair_score_internal", "tier", "trend_clusters", "pair_reason_short", "generated_at"],
  });
  await pairsSheet.addRows(prs.pairs.map((p) => ({
    pair_id: p.pair_id, collection_scope: p.collection_scope,
    top_product_id: p.top_product_id, bottom_product_id: p.bottom_product_id,
    pair_score_internal: p.pair_score_internal, tier: p.tier,
    trend_clusters: p.trend_clusters.join(","), pair_reason_short: p.pair_reason_short,
    generated_at: p.generated_at,
  })));
  // READBACK + VALIDATE
  await staging.loadHeaderRow();
  const got = await staging.getRows();
  if (got.length !== 44) throw new Error("row count " + got.length);
  const ids = new Set();
  const errs = [];
  for (const r of got) {
    ids.add(r.get("상품ID"));
    if (!r.get("상품명") || !r.get("공급사코드") || !r.get("판매가") || !r.get("raw_name")) {
      errs.push(r.get("상품ID") + " 필수 결손");
    }
  }
  if (ids.size !== 44) throw new Error("duplicate ids " + ids.size);
  if (errs.length) throw new Error(errs.join("; "));
  console.log(`STAGING OK: ${got.length} rows, ${BASE_HEADERS.length + EXT_HEADERS.length} cols, ${prs.pairs.length} pairs`);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
