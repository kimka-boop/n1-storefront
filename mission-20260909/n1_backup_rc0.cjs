#!/usr/bin/env node
/**
 * N1 SESSION N — RC0 DATA BACKUP (TASK 31)
 * 실행 위치: mission-20260909/  (env: ../.env.local — sheets.ts와 동일 로딩 경로)
 *
 * 대상: [Master DB] 스프레드시트의 "모든" 탭 (13개 실측)
 * 산출: N1_BACKUPS/rc0-20260909/data/
 *   - <tab>.json   : values.get UNFORMATTED_VALUE (복구 원본 — 표시 서식 아닌 "값" 기준)
 *   - <tab>.csv    : values.get FORMATTED_VALUE (사람 열람용 참조)
 *   - manifest.json: 탭별 행/열/셀 수 + sha256 + 소요시간 + 리포지토리 상태
 *
 * 읽기 전용 — 이 스크립트는 시트에 아무것도 쓰지 않는다.
 * 시크릿 불수록: 매니페스트에는 env "키 이름"만 기록한다.
 */
process.loadEnvFile("../.env.local");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JWT } = require("../node_modules/google-auth-library");

const OUT = path.resolve("../../N1_BACKUPS/rc0-20260909/data");
const SHEET_ID = process.env.N1_SHEET_ID;
if (!SHEET_ID) { console.error("N1_SHEET_ID missing"); process.exit(1); }

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function toCsv(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  const token = auth.credentials.access_token;
  const api = async (p) => {
    const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + p, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("API " + res.status + " " + (await res.text()).slice(0, 200));
    return res.json();
  };

  const t0 = Date.now();
  const meta = await api("?fields=properties.title,properties.timeZone,sheets.properties");
  const tabs = meta.sheets.map((s) => s.properties);

  const manifest = {
    backupAt: new Date().toISOString(),
    backupKind: "RC0_FULL_PRE_LAUNCH",
    spreadsheetId: SHEET_ID,
    spreadsheetTitle: meta.properties.title,
    timeZone: meta.properties.timeZone,
    valueRenderJson: "UNFORMATTED_VALUE",
    valueRenderCsv: "FORMATTED_VALUE",
    tabs: [],
    repo: null,
    durationsMs: {},
  };

  for (const p of tabs) {
    const name = p.title;
    const range = encodeURIComponent("'" + name.replace(/'/g, "''") + "'");
    const tTab = Date.now();
    const raw = await api("/values/" + range + "?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS");
    const fmt = await api("/values/" + range + "?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS");
    const rows = raw.values || [];
    const csvBuf = Buffer.from(toCsv(fmt.values || []), "utf-8");
    const jsonBuf = Buffer.from(JSON.stringify(rows, null, 1), "utf-8");
    const jsonFile = name + ".json";
    const csvFile = name + ".csv";
    fs.writeFileSync(path.join(OUT, jsonFile), jsonBuf);
    fs.writeFileSync(path.join(OUT, csvFile), csvBuf);
    manifest.tabs.push({
      tab: name,
      sheetId: p.sheetId,
      index: p.index,
      gridRows: p.gridProperties.rowCount,
      gridCols: p.gridProperties.columnCount,
      dataRows: rows.length,
      dataCols: rows.length ? Math.max(...rows.map((r) => r.length)) : 0,
      dataCells: rows.reduce((a, r) => a + r.length, 0),
      jsonSha256: sha256(jsonBuf),
      csvSha256: sha256(csvBuf),
      jsonBytes: jsonBuf.length,
    });
    manifest.durationsMs[name] = Date.now() - tTab;
    console.log("OK", name, rows.length + "rows", manifest.durationsMs[name] + "ms");
  }

  // repo 상태 (셸에서 주입받지 않고 여기서 이력만 남김 — 실제 산출은 밖에서 기록)
  const manifestPath = path.join(OUT, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("MANIFEST:", manifestPath);
  console.log("TOTAL_MS:", Date.now() - t0, "TABS:", manifest.tabs.length);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
