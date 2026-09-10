// SUPPLIER GATE RE-AUDIT — 라이브 Products 전수 재감사 (Corrective Directive §8)
// 라이브 시트를 수정하지 않는다(동결). 판정만 산출한다.
// 사용: node ops/supplier_gate_audit.cjs > N1_SUPPLIER_GATE_VERDICT.json
const fs = require("fs");
const path = require("path");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { execFileSync } = require("child_process");

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
  const sheet = doc.sheetsByTitle["Products"];
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  const candidates = rows.map((r) => {
    // 라이브 시트에는 자격 기록(Supplier_Qualification 탭)이 없다 — 증거 필드 전무 → UNVERIFIED 예상
    const supplier = String(r.get("공급사명") || "");
    const channel = supplier.includes("도매꾹") ? "DOMEGGOOK_BULK" : "UNKNOWN";
    return {
      product_id: String(r.get("상품ID") || ""),
      supplier_platform: supplier,
      supplier_channel: channel,
      // 라이브 시트에 자격 증거 필드가 없으므로 전부 UNKNOWN — 추론 금지 (§2)
      dropship_supported: "UNKNOWN",
      single_unit_order_supported: "UNKNOWN",
      end_customer_direct_shipping: "UNKNOWN",
      tracking_readable: "UNKNOWN",
      supplier_operational_confidence: 0,
    };
  });

  const out = execFileSync("python", ["mission-20260909/supplier_gate.py"], {
    input: JSON.stringify({ candidates }),
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(out);
  result.audit_context = {
    scope: "live Products tab (read-only — promotion frozen per directive §10)",
    total_products: candidates.length,
    supplier_platform_distribution: candidates.reduce((acc, c) => {
      acc[c.supplier_platform] = (acc[c.supplier_platform] || 0) + 1;
      return acc;
    }, {}),
    qualification_records_exist: false,
    note: "Supplier_Qualification 탭/상품 단위 증거 레코드가 존재하지 않아 전품 증거 없음 — 게이트가 전부 UNVERIFIED로 기각한다 (§8: UNVERIFIED는 publish-ready 후보 집합에서 제거)",
  };
  console.log(JSON.stringify(result, null, 1));
})().catch((e) => { console.error("AUDIT FAIL:", e.message); process.exit(1); });
