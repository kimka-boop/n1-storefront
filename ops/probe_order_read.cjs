// probe_order_read.cjs — findOrderById 로직 재현 디버그
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
  console.log("headerValues count:", (sheet.headerValues || []).length);
  const rows = await sheet.getRows();
  console.log("row count:", rows.length);
  const target = process.argv[2];
  const hit = rows.find((r) => String(r.get("주문번호") || "") === target);
  if (!hit) { console.log("HIT: none"); return; }
  const record = {};
  for (const key of Object.keys(sheet.headerValues || {})) record[key] = String(hit.get(key) ?? "");
  console.log("결제수단:", JSON.stringify(record["결제수단"]));
  console.log("주문번호:", JSON.stringify(record["주문번호"]));
  console.log("배송상태:", JSON.stringify(record["배송상태"]));
})().catch((e) => { console.error("PROBE FAIL:", e.message); process.exit(1); });
