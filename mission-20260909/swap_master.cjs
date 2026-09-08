#!/usr/bin/env node
/**
 * N1 LAUNCH 20260910 — MASTER DB SWAP (STEP 23)
 * 실행 위치: mission-20260909/   env: ../.env.local
 *
 * --swap      : Products(60행 구버전) → 백업_PRODUCTS_20260909 복사 후
 *               MASTER_DB_NEXT_20260909(44행)을 Products로 이관 (기존 29컬럼 schema 유지)
 * --rollback  : 백업_PRODUCTS_20260909 → Products 복원 (§4 rollback)
 *
 * 불변 탭: Orders / Orders_CS / Users / Refunds / Customer 관련 일체 (§3)
 * 이관 후 남성/여성/젠더리스 컬렉션 뷰 탭도 새 마스터에서 재구성한다.
 */
process.loadEnvFile("../.env.local");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");

const BACKUP_TAB = "백업_PRODUCTS_20260909";
const STAGING_TAB = "MASTER_DB_NEXT_20260909";
const GENDER_TABS = { MALE: "남성", FEMALE: "여성", GENDERLESS: "젠더리스" };
const GENDER_TAB_HEADERS = [
  "상품ID", "상품명", "카테고리", "공급사명", "공급사코드", "공급사URL", "매입가", "판매가",
  "마진율", "재고상태", "룩북상태", "갱신일", "룩북이미지URL", "소재", "세탁정보",
  "실측사이즈", "모델정보", "두께감", "신축성", "비침", "안감", "핏감", "원산지",
  "제조자", "제조연월", "색상옵션", "fit_profile", "unisex_score",
];

const str = (v) => String(v ?? "").trim();

(async () => {
  const mode = process.argv.includes("--rollback") ? "rollback" : process.argv.includes("--swap") ? "swap" : "";
  if (!mode) { console.error("usage: node swap_master.cjs --swap | --rollback"); process.exit(1); }
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

  async function ensureTabFrom(tabTitle, source) {
    const existing = doc.sheetsByTitle[tabTitle];
    if (existing) await doc.deleteSheet(existing.sheetId);
    const s = await doc.addSheet({ title: tabTitle });
    await rawResize(auth, s.sheetId, Math.max(source.rows.length + 1, 2), Math.max(source.headers.length, 2));
    await new Promise((r) => setTimeout(r, 800));
    await doc.loadInfo();
    const fresh = doc.sheetsByTitle[tabTitle];
    await fresh.setHeaderRow(source.headers);
    if (source.rows.length) await fresh.addRows(source.rows);
    return fresh;
  }

  if (mode === "swap") {
    const products = doc.sheetsByTitle["Products"];
    const current = await readAll(products);
    // 1) 구버전 백업 탭 생성 (이미 있으면 갱신)
    await ensureTabFrom(BACKUP_TAB, current);
    console.log(`backup: ${BACKUP_TAB} <- ${current.rows.length} rows`);
    // 2) 스테이징 읽기
    const staging = doc.sheetsByTitle[STAGING_TAB];
    const next = await readAll(staging);
    if (next.rows.length !== 44) throw new Error("staging rows " + next.rows.length);
    // 3) Products 원자적 교체: 데이터 행 전체 삭제 후 44행 기록 (index 0 유지 — sheetsByIndex[0] 계약)
    if (current.rows.length) await products.clearRows();
    const compact = next.rows.map((r) => {
      const o = {};
      for (const h of current.headers) o[h] = r[h] ?? "";
      return o;
    });
    await new Promise((r) => setTimeout(r, 400));
    await products.addRows(compact);
    console.log(`swap: Products <- ${compact.length} rows (next schema ${next.headers.length} -> live ${current.headers.length} cols)`);
    // 4) 성별 뷰 탭 재구성
    for (const [g, tab] of Object.entries(GENDER_TABS)) {
      const view = {
        headers: GENDER_TAB_HEADERS,
        rows: compact.filter((r) => r["성별"] === g).map((r) => {
          const o = {};
          for (const h of GENDER_TAB_HEADERS) o[h] = r[h] ?? "";
          return o;
        }),
      };
      await ensureTabFrom(tab, view);
      console.log(`view: ${tab} <- ${view.rows.length} rows`);
    }
  } else {
    // rollback
    const backup = doc.sheetsByTitle[BACKUP_TAB];
    if (!backup) throw new Error("no backup tab");
    const saved = await readAll(backup);
    const products = doc.sheetsByTitle["Products"];
    if (doc.sheetsByTitle.Products) await products.clearRows();
    await new Promise((r) => setTimeout(r, 400));
    const rows = saved.rows.map((r) => {
      const o = {};
      for (const h of saved.headers) o[h] = r[h] ?? "";
      return o;
    });
    if (rows.length) await products.addRows(rows);
    console.log(`rollback: Products <- ${rows.length} rows from ${BACKUP_TAB}`);
  }
  // 검증
  await doc.loadInfo();
  const p = doc.sheetsByTitle["Products"];
  const after = await readAll(p);
  console.log(`verify: Products ${after.rows.length} rows, index=${p.index}, sample=${after.rows[0] ? after.rows[0]["상품ID"] + " / " + after.rows[0]["상품명"] : "(empty)"}`);
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
