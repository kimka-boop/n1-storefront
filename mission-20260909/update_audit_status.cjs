#!/usr/bin/env node
/* 스테이징 탭 audit_status 갱신: PENDING_HERMES_REVIEW → HERMES_APPROVED_20260909 */
process.loadEnvFile("../.env.local");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");

(async () => {
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  const s = doc.sheetsByTitle["MASTER_DB_NEXT_20260909"];
  const rows = await s.getRows();
  let n = 0;
  for (const r of rows) {
    if (String(r.get("audit_status")) === "PENDING_HERMES_REVIEW") {
      r.set("audit_status", "HERMES_APPROVED_20260909");
      await r.save();
      n++;
    }
  }
  console.log("audit_status updated:", n);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
