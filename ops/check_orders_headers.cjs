// ORD-0 검증 스크립트 — Orders 탭 헤더 상태 읽기 (read-only)
// 사용: node ops/check_orders_headers.cjs
const fs = require("fs");
const path = require("path");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      let val = m[2];
      if (val.startsWith('"')) {
        // 멀티라인 quoted 값 — 닫는 quote가 나올 때까지 합친다 (dotenv 규약)
        while (!val.endsWith('"') || val.endsWith('\\"')) {
          i += 1;
          if (i >= lines.length) break;
          val += "\n" + lines[i];
        }
        val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
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
  if (!sheet) {
    console.log("ORDERS_TAB: MISSING");
    return;
  }
  await sheet.loadHeaderRow();
  console.log("ORDERS_TAB:", sheet.title, "rows:", sheet.rowCount);
  console.log("HEADERS:", JSON.stringify(sheet.headerValues));
  const rows = await sheet.getRows({ limit: 5 });
  for (const r of rows) {
    const orderNo = r.get("주문번호");
    const orderIdEn = r.get("order_id");
    console.log("ROW sample:", JSON.stringify({ orderNo, orderIdEn, pay: r.get("결제상태") || r.get("payment_status"), name: r.get("고객명") || r.get("customer_name") }));
  }
})().catch((e) => {
  console.error("READBACK_FAIL:", e.message);
  process.exit(1);
});
