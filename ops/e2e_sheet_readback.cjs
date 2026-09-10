// E2E 검증 보조 — 시트 상태 판독(읽기 전용). 테스트 계정 행만 출력한다.
const fs = require("fs");
// .env.local 파서 — 따옴표 묶인 여러 줄 값(PEM 키) 지원
{
  const raw = fs.readFileSync(".env.local", "utf8");
  const re = /^([A-Z_0-9]+)=("[^"]*"|[^\n]*)/gm;
  let m;
  while ((m = re.exec(raw))) {
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
(async () => {
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(process.env.N1_SHEET_ID, auth);
  await doc.loadInfo();
  const rows = await doc.sheetsByTitle["Users"].getRows();
  const hit = rows.find((r) => String(r.get("이메일")).trim().toLowerCase() === "ksbsamedad@gmail.com");
  if (!hit) { console.log("Users row not found"); return; }
  console.log("Users row:", JSON.stringify({
    username: hit.get("사용자이름"),
    emailVerifyCol: hit.get("이메일인증"),
    joinedAt: hit.get("가입일"),
  }));
  const vrows = await doc.sheetsByTitle["Email_Verifications"].getRows();
  const mine = vrows.filter((r) => String(r.get("이메일")).toLowerCase() === "ksbsamedad@gmail.com");
  console.log("Email_Verifications rows for test email:", mine.length);
  for (const r of mine) {
    const h = String(r.get("토큰해시"));
    console.log(" - purpose:", r.get("목적"), "| stored as 64-hex hash:", /^[0-9a-f]{64}$/.test(h), "| used:", JSON.stringify(r.get("사용일")));
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
