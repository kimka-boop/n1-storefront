#!/usr/bin/env node
/**
 * N1 SESSION N — ROLLBACK DRILL PHASE 2v2 (TASK 31) — LOCAL PIVOT
 *
 * 배경: 서비스 계정 Drive 저장소 한도 초과로 "새 스프레드시트 생성/복사" 불가 (files.copy →
 *       storageQuotaExceeded, 2026-09-09 실측). 프로덕션 문서에는 절대 쓰지 않는 안전 경계를 유지.
 * 따라서 본 drill은:
 *   (1) 백업 == 라이브 실측: 지금 다시 읽은 프로덕션 13개 탭 전수를 백업 JSON과 deep-equal 대조
 *       → "이 백업으로 복원하면 라이브와 동일한 데이터가 된다"를 값 수준에서 증명
 *   (2) 로컬 복원 대상 재구성 + sha256 전수 재검증 (phase 1 반복 포인트)
 *   (3) 라이브 앱 스모크(읽기 전용): 복원본과 동일한 데이터를 실제 Next.js 코드 경로로 렌더
 *       → 복원 후 앱 동작의 동치 근거 (products/pairs/stock/lookup/홈)
 * Google 쓰기 경계 복원 검증은 스크립트(n1_drill_phase2_staging.cjs)로 남겨 두었다 —
 * Drive 한도 해제 후 동일 스크립트로 실행하는 것을 RUNBOOK에 명시.
 */
process.loadEnvFile("../.env.local");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JWT } = require("../node_modules/google-auth-library");

const ROOT = path.resolve("../../N1_BACKUPS/rc0-20260909");
const DATA = path.join(ROOT, "data");
const STAGE = path.join(ROOT, "drill", "staging-doc");
const SHEET_ID = process.env.N1_SHEET_ID;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf-8"));

const results = [];
const log = (ok, name, detail) => { results.push({ ok, name, detail }); console.log((ok ? "PASS" : "FAIL") + " | " + name + " | " + detail); };

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf-8"));
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  const api = async (p) => {
    const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + p, {
      headers: { Authorization: "Bearer " + auth.credentials.access_token },
    });
    if (!res.ok) throw new Error("API " + res.status + " " + (await res.text()).slice(0, 200));
    return res.json();
  };

  // ── STEP A: 라이브 재판정 — 프로덕션 지금 값 vs 백업 (전수 deep-equal)
  const tA = Date.now();
  let liveOk = 0; const liveFail = [];
  for (const t of manifest.tabs) {
    const got = await api("/values/" + encodeURIComponent("'" + t.tab + "'") + "?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS");
    const live = got.values || [];
    const backup = read(DATA, t.tab + ".json");
    if (JSON.stringify(live) === JSON.stringify(backup)) liveOk++;
    else {
      // 어느 쪽이 다른지 요약 (행 수 + 첫 불일치 좌표)
      let where = "rowcount " + live.length + " vs " + backup.length;
      if (live.length === backup.length) {
        for (let i = 0; i < live.length; i++) {
          if (JSON.stringify(live[i]) !== JSON.stringify(backup[i])) { where = "first diff row " + (i + 1); break; }
        }
      }
      liveFail.push(t.tab + " (" + where + ")");
    }
  }
  log(liveFail.length === 0, "STEP-A backup==live (13 tabs)", liveOk + "/" + manifest.tabs.length + " identical" + (liveFail.length ? " DRIFT:" + liveFail.join("; ") : "") + " [" + (Date.now() - tA) + "ms]");

  // ── STEP B: 로컬 복원 대상(staging-doc) 구성 + 전수 sha256 재검증
  const tB = Date.now();
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  for (const t of manifest.tabs) fs.copyFileSync(path.join(DATA, t.tab + ".json"), path.join(STAGE, t.tab + ".json"));
  let hashOk = 0;
  for (const t of manifest.tabs) {
    if (sha256(fs.readFileSync(path.join(STAGE, t.tab + ".json"))) === t.jsonSha256) hashOk++;
  }
  log(hashOk === manifest.tabs.length, "STEP-B local restore target rebuilt+verified", hashOk + "/" + manifest.tabs.length + " sha256 match [" + (Date.now() - tB) + "ms]");

  fs.writeFileSync(path.join(ROOT, "drill", "phase2v2_result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log("\nPHASE2v2 DATA RESULT: " + pass + "/" + results.length + " PASS");
  if (pass !== results.length) process.exit(1);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
