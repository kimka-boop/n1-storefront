#!/usr/bin/env node
/**
 * N1 SESSION N — ROLLBACK DRILL PHASE 1 (TASK 31)
 * 파일 레벨 restore drill: 백업 → (샌드박스에서) 손상 시뮬레이션 → 백업으로 복원 → 검증
 *
 * 원칙: 프로덕션 시트에 쓰지 않는다. 모든 손상은 N1_BACKUPS/rc0-20260909/drill/sandbox 안에서만.
 * 검증: (1) 복원 파일 sha256 == 매니페스트 sha256  (2) 행 수 일치  (3) 필드 스팟체크
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve("../../N1_BACKUPS/rc0-20260909");
const DATA = path.join(ROOT, "data");
const SB = path.join(ROOT, "drill", "sandbox");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf-8"));

const results = [];
const log = (ok, name, detail) => { results.push({ ok, name, detail }); console.log((ok ? "PASS" : "FAIL") + " | " + name + " | " + detail); };

(async () => {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(SB, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf-8"));

  // ── STEP 0: 샌드박스 = 백업 사본
  for (const t of manifest.tabs) {
    fs.copyFileSync(path.join(DATA, t.tab + ".json"), path.join(SB, t.tab + ".json"));
  }
  log(true, "STEP0 sandbox=backup copy", manifest.tabs.length + " tabs copied");

  // ── STEP 1: 현실적 손상 시뮬레이션 4종 (RC0 이후 사고 시나리오)
  //  1) Products: 3행 삭제 + 판매가 오염 + 중복 행 유입 (배치 잡 사고)
  const prod = read(SB, "Products.json");
  const header = prod[0];
  const prodBefore = prod.slice(1);
  const corrupted = [header, ...prodBefore.slice(3)]; // 앞 3개 상품 유실
  corrupted[1][1] = corrupted[1][1] + "!!손상";        // 상품명 오염
  const priceCol = header.indexOf("판매가");
  corrupted[2][priceCol] = corrupted[2][priceCol] * 10; // 가격 10배 오염
  corrupted.push([...prodBefore[0]]);                  // 중복 행 유입
  fs.writeFileSync(path.join(SB, "Products.json"), JSON.stringify(corrupted, null, 1));

  //  2) Orders: items_json 논리 손상 (JSON 문자열 깨짐)
  const orders = read(SB, "Orders.json");
  const itemsCol = orders[0].indexOf("items_json");
  if (orders[1] && itemsCol >= 0) orders[1][itemsCol] = '{"broken": tru';
  fs.writeFileSync(path.join(SB, "Orders.json"), JSON.stringify(orders, null, 1));

  //  3) Users: 헤더 행 유실 (addSheet 재생성 사고)
  const users = read(SB, "Users.json");
  users.shift();
  fs.writeFileSync(path.join(SB, "Users.json"), JSON.stringify(users, null, 1));

  //  4) Pairs: BELOW_THRESHOLD 페어 유입 + top/bottom 뒤집힘 (배치 논리 사고)
  const pairs = read(SB, "Pairs.json");
  const pHeader = pairs[0];
  const flipped = [...pairs[1]];
  const topC = pHeader.indexOf("top_product_id");
  const botC = pHeader.indexOf("bottom_product_id");
  [flipped[topC], flipped[botC]] = [flipped[botC], flipped[topC]];
  flipped[pHeader.indexOf("tier")] = "BELOW_THRESHOLD";
  pairs.push(flipped);
  fs.writeFileSync(path.join(SB, "Pairs.json"), JSON.stringify(pairs, null, 1));
  log(true, "STEP1 corruption injected", "Products -3rows+dup+2field corrupt / Orders items_json broken / Users header lost / Pairs flipped+below");

  // ── STEP 2: 복원 (백업 → 샌드박스 덮어쓰기)
  const tRestore = Date.now();
  for (const t of manifest.tabs) {
    fs.copyFileSync(path.join(DATA, t.tab + ".json"), path.join(SB, t.tab + ".json"));
  }
  const restoreMs = Date.now() - tRestore;
  log(true, "STEP2 restore executed", manifest.tabs.length + " tabs restored in " + restoreMs + "ms");

  // ── STEP 3: 검증 — sha256 == 매니페스트
  let hashOk = 0, hashFail = [];
  for (const t of manifest.tabs) {
    const h = sha256(fs.readFileSync(path.join(SB, t.tab + ".json")));
    if (h === t.jsonSha256) hashOk++; else hashFail.push(t.tab);
  }
  log(hashFail.length === 0, "STEP3a sha256 all tabs", hashOk + "/" + manifest.tabs.length + " match" + (hashFail.length ? " FAIL:" + hashFail : ""));

  // ── STEP 4: 검증 — 구조 + 스팟체크 (복원된 내용이 "진짜"인지 — 원본 백업과 전수 비교)
  let deepOk = 0; const deepFail = [];
  for (const t of manifest.tabs) {
    const restored = read(SB, t.tab + ".json");
    const pristine = read(DATA, t.tab + ".json");
    if (JSON.stringify(restored) === JSON.stringify(pristine)) deepOk++;
    else deepFail.push(t.tab);
  }
  log(deepFail.length === 0, "STEP4a all-tabs deep-equal vs pristine backup", deepOk + "/" + manifest.tabs.length + (deepFail.length ? " FAIL:" + deepFail : ""));

  const p2 = read(SB, "Products.json");
  log(p2.length === 45, "STEP4b Products row count", p2.length + " rows (44 products + header)");
  const firstId = p2[1][p2[0].indexOf("상품ID")];
  const firstName = p2[1][p2[0].indexOf("상품명")];
  log(firstId === "PRD-N1-01", "STEP4c Products spot field", "row1 = " + String(firstId) + " / " + String(firstName).slice(0, 24));
  const o2 = read(SB, "Orders.json");
  log(o2[1] && o2[1][0] === "ORD-TEST-E2E-001", "STEP4d Orders row intact", "order_id=" + String(o2[1] && o2[1][0]));
  const u2 = read(SB, "Users.json");
  log(u2.length === 9 && u2[0][0] === "이메일", "STEP4e Users header + rows", "row0[0]=" + String(u2[0][0]) + ", " + (u2.length - 1) + " users");
  const pr2 = read(SB, "Pairs.json");
  const tiers = {};
  pr2.slice(1).forEach((r) => { const v = r[pr2[0].indexOf("tier")]; tiers[v] = (tiers[v] || 0) + 1; });
  log(tiers.BEST_MATCH === 5 && tiers.SECONDARY === 12 && tiers.BELOW_THRESHOLD === 3,
    "STEP4f Pairs tier histogram", JSON.stringify(tiers));

  const pass = results.filter((r) => r.ok).length;
  console.log("\nPHASE1 RESULT: " + pass + "/" + results.length + " PASS, restoreMs=" + restoreMs);
  fs.writeFileSync(path.join(ROOT, "drill", "phase1_result.json"), JSON.stringify({ at: new Date().toISOString(), restoreMs, results }, null, 2));
  if (pass !== results.length) process.exit(1);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
