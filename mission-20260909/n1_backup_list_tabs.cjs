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
  console.log("TITLE:", doc.title);
  console.log("ID:", process.env.N1_SHEET_ID);
  for (const [name, s] of Object.entries(doc.sheetsByTitle)) {
    console.log(JSON.stringify({ tab: name, rows: s.rowCount, cols: s.columnCount, index: s.index }));
  }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
