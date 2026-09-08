// 라이브 Products 탭의 룩북이미지URL을 스테이징의 source_image로 채움 (상품ID 매칭, §3 범위 준수)
process.loadEnvFile("../.env.local");
const { GoogleSpreadsheet } = require("../node_modules/google-spreadsheet");
const { JWT } = require("../node_modules/google-auth-library");
(async () => {
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  const staging = await (await doc.sheetsByTitle["MASTER_DB_NEXT_20260909"]).getRows();
  const imgBySku = {};
  for (const r of staging) imgBySku[str(r.get("공급사코드"))] = str(r.get("룩북이미지URL"));
  const products = doc.sheetsByTitle["Products"];
  const rows = await products.getRows();
  let n = 0;
  for (const r of rows) {
    const sku = str(r.get("공급사코드"));
    const img = imgBySku[sku];
    if (img && str(r.get("룩북이미지URL")) !== img) {
      r.set("룩북이미지URL", img);
      await r.save();
      n++;
    }
  }
  console.log("live Products images updated:", n);
  function str(v) { return String(v ?? "").trim(); }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
