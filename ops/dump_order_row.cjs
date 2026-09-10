// ORD-0 최종 검증 — 신규 주문 행 전체 필드 덤프
const fs = require("fs");
const path = require("path");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      let val = m[2];
      if (val.startsWith('"')) {
        while (!val.endsWith('"') && i < lines.length) { i += 1; val += "\n" + lines[i]; }
        val = val.slice(1, -1).replace(/\\n/g, "\n");
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
    i += 1;
  }
}

(async () => {
  loadEnvLocal();
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["Orders"];
  await sheet.loadHeaderRow();
  const target = process.argv[2] || "ORD-20260910-84113";
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("주문번호") || "") === target);
  if (!row) { console.log("ORDER_ROW_NOT_FOUND:", target); return; }
  const dump = {};
  for (const h of sheet.headerValues) dump[h] = String(row.get(h) ?? "");
  console.log("HEADERS_COUNT:", sheet.headerValues.length);
  console.log(JSON.stringify(dump, null, 1));
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
