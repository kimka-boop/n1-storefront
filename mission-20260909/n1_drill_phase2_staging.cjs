#!/usr/bin/env node
/**
 * N1 SESSION N — ROLLBACK DRILL PHASE 2 (TASK 31)
 * 스테이징 문서 복원 drill: 백업 데이터 → "새" 스프레드시트에 전량 복원 → API read-back 전수 검증.
 *
 * 안전 경계: 프로덕션 문서(N1_SHEET_ID)는 읽지도 쓰지도 않는다 — 새 문서만 생성한다.
 * 검증: values.get(UNFORMATTED_VALUE) read-back == 백업 JSON deep-equal (13개 탭 전부)
 */
process.loadEnvFile("../.env.local");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JWT } = require("../node_modules/google-auth-library");

const ROOT = path.resolve("../../N1_BACKUPS/rc0-20260909");
const DATA = path.join(ROOT, "data");
const SHEET_ID = process.env.N1_SHEET_ID;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf-8"));

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf-8"));
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  const token = () => auth.credentials.access_token;
  const api = async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error("API " + res.status + " " + text.slice(0, 200));
    return text ? JSON.parse(text) : {};
  };
  const base = "https://sheets.googleapis.com/v4/spreadsheets/";

  // ── STEP 1: 새 스테이징 문서 생성 (프로덕션 문서와 완전히 별개)
  const t0 = Date.now();
  const created = await api("POST", base + "?fields=spreadsheetId,properties.title", {
    properties: { title: "N1_RC0_RESTORE_DRILL_20260909" },
  });
  const drillId = created.spreadsheetId;
  console.log("CREATED drill doc:", drillId, created.properties.title);

  // 기본 Sheet1 제거 + 13개 탭을 매니페스트의 grid 크기로 생성
  const info = await api("GET", base + drillId + "?fields=sheets.properties");
  const defaultSheet = info.sheets.find((s) => s.properties.title === "Sheet1");
  const delReqs = defaultSheet ? [{ deleteSheet: { sheetId: defaultSheet.properties.sheetId } }] : [];
  const addReqs = manifest.tabs.map((t) => ({
    addSheet: {
      properties: {
        title: t.tab,
        gridProperties: { rowCount: t.gridRows, columnCount: t.gridCols },
      },
    },
  }));
  await api("POST", base + drillId + ":batchUpdate", { requests: [...delReqs, ...addReqs] });
  console.log("TABS created:", manifest.tabs.length, "in", Date.now() - t0, "ms");

  // ── STEP 2: 복원 — 백업 JSON → values.update 전량 기록
  const tWrite = Date.now();
  for (const t of manifest.tabs) {
    const rows = read(t.tab + ".json");
    const range = encodeURIComponent("'" + t.tab + "'!A1");
    await api("PUT", base + drillId + "/values/" + range + "?valueInputOption=RAW", {
      values: rows.length ? rows : [[""]],
    });
    console.log("WROTE", t.tab, rows.length + "rows");
  }
  const writeMs = Date.now() - tWrite;
  console.log("WRITE PHASE:", writeMs, "ms");

  // ── STEP 3: read-back 전수 검증 (deep-equal vs 백업)
  let ok = 0; const fail = [];
  const tVerify = Date.now();
  for (const t of manifest.tabs) {
    const got = await api("GET", base + drillId + "/values/" + encodeURIComponent("'" + t.tab + "'") + "?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS");
    const rows = got.values || [];
    const pristine = read(t.tab + ".json");
    if (JSON.stringify(rows) === JSON.stringify(pristine)) ok++;
    else fail.push(t.tab + "(" + rows.length + "vs" + pristine.length + ")");
  }
  const verifyMs = Date.now() - tVerify;
  console.log("READBACK: " + ok + "/" + manifest.tabs.length + " deep-equal" + (fail.length ? " FAIL:" + fail.join(",") : "") + " in " + verifyMs + "ms");

  fs.writeFileSync(path.join(ROOT, "drill", "phase2_doc.json"), JSON.stringify({
    at: new Date().toISOString(),
    drillSpreadsheetId: drillId,
    title: created.properties.title,
    writeMs, verifyMs,
    readbackOk: ok,
    readbackFail: fail,
  }, null, 2));
  console.log("RESULT:" + (fail.length === 0 ? "PASS" : "FAIL"));
  if (fail.length) process.exit(1);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
