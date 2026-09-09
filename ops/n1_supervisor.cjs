#!/usr/bin/env node
/**
 * N°1 SESSION M — Runtime Resilience Supervisor (TASK 30, RC0 기준)
 *
 * 기존 구조와의 정합:
 *   - Windows/local launch architecture 그대로: `next start -p PORT` 프로세스를
 *     node가 직접 자식으로 띄우고 감시한다. PM2·NSSM·Windows 서비스·Docker 등
 *     새로운 infra를 도입하지 않는다 (stock_watcher.cjs · qa-proxy*.cjs와 같은
 *     "node .cjs + Git Bash" 기존 관용의 연장선).
 *   - Alert는 기존 admin channel을 재사용한다: lib/telegram.ts의
 *     sendTelegramMessage + N1_CS_BOT_TOKEN/N1_CS_CHAT_ID (앱이 쓰는 것과 동일
 *     코드 경로 — TS transpile 재사용 방식은 stock_watcher.cjs와 동일).
 *
 * 감시 대상 (단일 Next.js 프로세스 = Storefront + App/API 이중 표면):
 *   FAST liveness  (기본 10초): GET /api/health (프로세스 로컬, 외부 호출 없음)
 *                              + GET / (Storefront 셸 200)
 *   SLOW readiness (기본 5분):  Orders 경로 계약(POST 빈본문 → 400),
 *                              Stock 서비스 계약(GET /api/stock?sku → 200 n1.stock.v1),
 *                              HERMES bridge(디렉토리 + ledger.json 가독, inbound 정체 관찰),
 *                              Telegram 경로(env 구성 존재 — 값 미노출)
 *
 * 재시작 정책:
 *   - 프로세스 사망 → 포트 반납 대기 후 backoff(1s→2s→…→30s cap) 재기동.
 *   - crash-loop 가드: 10분 내 5회 비정상 종료 → HOLD(5분마다 1회 재시도) + CRITICAL alert.
 *   - 프로세스 생존 + HTTP 연속 3회 실패(30초) → hang 판정, 트리 kill 후 재기동.
 *
 * Alert spam 방지 (ops/state.json에 영속 — supervisor 재시작에도 유지):
 *   - 컴포넌트별 cooldown 30분, 전역 상한 시간당 5건, 동일 상태 연속 중복 억제.
 *   - RECOVERED 통지는 cooldown 면제(단 전역 상한은 적용).
 *
 * 사용:
 *   node ops/n1_supervisor.cjs                       # 감시 루프 (foreground)
 *   node ops/n1_supervisor.cjs --port 3322           # 포트 지정 (기본 3322)
 *   node ops/n1_supervisor.cjs --once                # 1회 전체 점검 후 종료 (스모크)
 *   node ops/n1_supervisor.cjs --dry-run             # alert을 채널 대신 로그로만
 *   node ops/n1_supervisor.cjs --test-alert          # 채널 1회 테스트 발송 (spam-guard 우회, 조치 불요)
 *   node ops/n1_supervisor.cjs --selftest            # spam-guard 순수 로직 단언 (네트워크 없음)
 *
 * 시크릿 계약: 토큰·키 값을 로그/상태/alert에 절대 기록하지 않는다 (미션 §48).
 */
try { process.loadEnvFile?.(".env.local"); } catch {} // .env.local 부재 환경 허용 (env는 상위에서 주입 가능)

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

// --- lib/telegram.ts 재사용 (stock_watcher.cjs와 동일한 TS transpile 방식) -------------
function loadTelegramSender() {
  try {
    const ts = require("../node_modules/typescript");
    require.extensions[".ts"] = (module, filename) => {
      const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      }).outputText;
      module._compile(code, filename);
    };
    const telegram = require("../lib/telegram.ts");
    return telegram.sendTelegramMessage;
  } catch (e) {
    console.error("[sup] lib/telegram.ts 재사용 실패 — alert은 로그로만 간다:", e.message);
    return null;
  }
}

// --- 설정 ------------------------------------------------------------------------------
const args = process.argv.slice(2);
const OPT = {
  port: Number((args.includes("--port") && args[args.indexOf("--port") + 1]) || process.env.N1_PORT || 3322),
  intervalMs: Number((args.includes("--interval-ms") && args[args.indexOf("--interval-ms") + 1]) || 10000),
  deepIntervalMs: Number((args.includes("--deep-interval-ms") && args[args.indexOf("--deep-interval-ms") + 1]) || 300000),
  dryRun: args.includes("--dry-run") || process.env.N1_ALERT_DRY_RUN === "1",
  once: args.includes("--once"),
  selftest: args.includes("--selftest"),
  testAlert: args.includes("--test-alert"),
};
const ROOT = path.resolve(__dirname, "..");
const OPS = path.join(ROOT, "ops");
const LOGDIR = path.join(OPS, "logs");
const STATE_FILE = path.join(OPS, "state.json");
const LOCK_FILE = path.join(OPS, "supervisor.pid");
const LEDGER = path.join(ROOT, "mission-20260909", "N1_STOCK_BRIDGE", "ledger.json");
const BRIDGE_INBOUND = path.join(ROOT, "mission-20260909", "N1_STOCK_BRIDGE", "inbound");
const INBOUND_STALE_MS = 30 * 60 * 1000; // 미소비 inbound가 이보다 오래 정체 → WARN (HERMES 외부 관찰)
const BACKOFF_MAX_MS = 30000;
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const CRASH_LOOP_LIMIT = 5;
const HOLD_RETRY_MS = 5 * 60 * 1000;
const WARMUP_LIMIT_MS = 90 * 1000; // 기동 후 이 시간 내 readiness 미성립 → 기동 실패 판정(재기동)
const HUNG_STRIKES = 3;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const ALERT_RATE_WINDOW_MS = 60 * 60 * 1000;
const ALERT_RATE_MAX = 5;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP = 3;

// --- 로그 (size rotation, N개 유지) -----------------------------------------------------
function openRotating(name) {
  const file = path.join(LOGDIR, name);
  const rotate = () => {
    try {
      for (let i = LOG_KEEP - 1; i >= 1; i--) {
        const from = `${file}.${i}`;
        const to = `${file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
    } catch {}
  };
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) rotate();
  } catch {}
  const stream = fs.createWriteStream(file, { flags: "a" });
  return {
    write(line) {
      try {
        if (fs.statSync(file).size > LOG_MAX_BYTES) {
          stream.end();
          rotate();
          return openRotating(name).write(line);
        }
      } catch {}
      stream.write(line);
    },
  };
}

const supLog = openRotating("supervisor.log");
function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  supLog.write(line);
  process.stdout.write(line);
}

// --- 상태 영속 (restart 이력 + spam-guard 쿨다운이 supervisor 재시작을 넘어 유지) --------
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      exits: Array.isArray(s.exits) ? s.exits : [],
      alerts: Array.isArray(s.alerts) ? s.alerts : [],
      lastAlertKey: s.lastAlertKey || null,
      totalRestarts: s.totalRestarts || 0,
      startedOnce: Boolean(s.startedOnce),
    };
  } catch {
    return { exits: [], alerts: [], lastAlertKey: null, totalRestarts: 0, startedOnce: false };
  }
}
const state = loadState();
function saveState() {
  try {
    fs.mkdirSync(OPS, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log("WARN", `state.json 기록 실패: ${e.message}`);
  }
}

// --- Alert spam-guard (순수 로직 — --selftest로 단언) ------------------------------------
function pruneOld(records, now, windowMs) {
  return records.filter((r) => now - r.ts < windowMs);
}

/** @returns {send|suppress, reason} */
function alertDecision(state, component, severity, now) {
  // RECOVERED 기록은 cooldown 계산에서 제외 — 복구 통지 직후의 새 장애는 즉시 알린다
  const withinCooldown = state.alerts.some(
    (a) =>
      a.component === component &&
      a.severity !== "RECOVERED" &&
      severity !== "RECOVERED" &&
      now - a.ts < ALERT_COOLDOWN_MS,
  );
  if (withinCooldown) return { send: false, reason: "component-cooldown" };

  const recent = pruneOld(state.alerts, now, ALERT_RATE_WINDOW_MS);
  if (recent.length >= ALERT_RATE_MAX) return { send: false, reason: "global-rate-cap" };

  const key = `${component}:${severity}`;
  if (state.lastAlertKey === key && severity !== "RECOVERED") {
    const last = state.alerts.find((a) => `${a.component}:${a.severity}` === key);
    if (last && now - last.ts < ALERT_RATE_WINDOW_MS) return { send: false, reason: "duplicate" };
  }
  return { send: true, reason: "ok" };
}

function recordAlert(state, component, severity, now) {
  state.alerts = pruneOld(state.alerts, now, ALERT_RATE_WINDOW_MS);
  state.alerts.push({ ts: now, component, severity });
  state.lastAlertKey = `${component}:${severity}`;
}

async function sendAlert(component, severity, detail) {
  const now = Date.now();
  const decision = alertDecision(state, component, severity, now);
  const text =
    `[N1 ${severity === "RECOVERED" ? "RECOVERED" : "ALERT"}] ${component}\n` +
    `${detail}\n` +
    `at ${new Date(now).toISOString()} · port ${OPT.port}`;
  if (!decision.send) {
    log("INFO", `alert 억제(${decision.reason}): ${component} ${severity}`);
    return { sent: false, reason: decision.reason };
  }
  recordAlert(state, component, severity, now);
  saveState();
  if (OPT.dryRun) {
    log("ALERT(dry-run)", text.replace(/\n/g, " | "));
    return { sent: true, reason: "dry-run" };
  }
  const send = loadTelegramSender();
  if (!send) {
    log("ALERT", text.replace(/\n/g, " | "));
    return { sent: false, reason: "no-sender" };
  }
  const token = (process.env.N1_CS_BOT_TOKEN || "").trim();
  const chat = (process.env.N1_CS_CHAT_ID || "").trim();
  if (!token || !chat) {
    log("ALERT", `[telegram 미구성 — 채널 미전송] ${text.replace(/\n/g, " | ")}`);
    return { sent: false, reason: "unconfigured" };
  }
  const r = await send(token, chat, text);
  log(r.ok ? "ALERT" : "ALERT-FAILED", `${component} ${severity} → telegram ok:${r.ok}`);
  return { sent: r.ok, reason: r.ok ? "sent" : "telegram-error" };
}

// --- HTTP/포트 유틸 ----------------------------------------------------------------------
function fetchStatus(urlPath, { method = "GET", body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: OPT.port, path: urlPath, method, timeout: 5000 },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: raw.slice(0, 2000) }));
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForPortFree(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portFree(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --- 자식 프로세스 (next start) ----------------------------------------------------------
let child = null;
let childStartedAt = 0;
let backoffIdx = 0;
let exitTimestamps = [];
let holding = false;
let hungStrikes = 0;
let lastLivenessDownAlertAt = 0;
let stopping = false;
// readiness gate: 첫 liveness 성립 전에는 실패 카운트·deep check를 전부 보류한다.
// (기동 지연을 장애로 오판해 false CRITICAL alert을 채널에 쏘는 것을 구조적으로 차단)
let appReadyOnce = false;

const appOut = openRotating("app-stdout.log");
const appErr = openRotating("app-stderr.log");

function spawnApp() {
  // 승산 없는 재시작 반복을 피하기 위한 사전 점검 — 빌드 소실은 stderr 말고 supervisor.log에서
  // 바로 원인이 보이게 한다 (2026-09-09 실측: 타 세션 next dev가 .next를 dev 아티팩트로 대체).
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    log("ERROR", "production build 없음 (.next/BUILD_ID) — 'npx next build' 후 재시작 (RUNBOOK §R-3)");
  }
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  child = spawn(process.execPath, [nextBin, "start", "-p", String(OPT.port)], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childStartedAt = Date.now();
  hungStrikes = 0;
  log("INFO", `spawn next start pid=${child.pid} port=${OPT.port}`);
  child.stdout.on("data", (d) => appOut.write(d.toString()));
  child.stderr.on("data", (d) => appErr.write(d.toString()));
  child.on("exit", (code, signal) => {
    const now = Date.now();
    const uptime = now - childStartedAt;
    appReadyOnce = false; // 재기동 후엔 readiness 게이트를 다시 통과해야 deep check 재개
    exitTimestamps = pruneOld(exitTimestamps.concat(now), now, CRASH_WINDOW_MS);
    state.exits = pruneOld(state.exits.concat({ ts: now, code, signal, uptimeMs: uptime }), now, CRASH_WINDOW_MS);
    log("WARN", `child exit pid=${child?.pid} code=${code} signal=${signal} uptimeMs=${uptime}`);
    if (stopping) return;
    state.totalRestarts += 1;
    saveState();
    if (uptime < CRASH_WINDOW_MS && exitTimestamps.length >= CRASH_LOOP_LIMIT) {
      holding = true;
      sendAlert("app", "CRITICAL",
        `crash-loop 감지: ${CRASH_LOOP_LIMIT}회/${CRASH_WINDOW_MS / 60000}분 — 재시작 HOLD(HOLD_RETRY_MS 간격 재시도). 수동 개입 필요. 최근 code=${code} signal=${signal}`);
    } else {
      sendAlert("app", "CRITICAL",
        `프로세스 사망(code=${code} signal=${signal}, uptime ${Math.round(uptime / 1000)}s) — 자동 재시작 예약`);
    }
    scheduleRestart();
  });
}

function scheduleRestart() {
  const delay = holding ? HOLD_RETRY_MS : Math.min(BACKOFF_MAX_MS, 1000 * 2 ** backoffIdx);
  backoffIdx = Math.min(backoffIdx + 1, 6);
  log("INFO", `restart 예약 in ${delay}ms (holding=${holding})`);
  setTimeout(async () => {
    if (stopping) return;
    const freed = await waitForPortFree(OPT.port, 15000);
    if (!freed) log("WARN", `port ${OPT.port} 반납 대기 15s 초과 — 기동 시도는 계속`);
    else log("INFO", `port ${OPT.port} 반납 확인 — rebind 진행`);
    if (holding) {
      const stillLooping = pruneOld(exitTimestamps, Date.now(), CRASH_WINDOW_MS).length >= CRASH_LOOP_LIMIT;
      if (stillLooping) {
        log("WARN", "HOLD 유지 — crash-window 미경과, 다음 주기 재시도");
        scheduleRestart();
        return;
      }
      holding = false;
      backoffIdx = 0;
      log("INFO", "HOLD 해제 — crash-window 경과, 재기동 재개");
    }
    spawnApp();
  }, delay);
}

function killTree() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

// --- 헬스 프로브 -------------------------------------------------------------------------
async function livenessProbe() {
  const health = await fetchStatus("/api/health");
  const home = await fetchStatus("/");
  const appOk = health.status === 200;
  const storefrontOk = home.status === 200;
  return { appOk, storefrontOk, health, home };
}

async function deepChecks() {
  const out = {};
  // Orders 경로: 빈 본문 → 400 (시트 쓰기 없는 계약 프로브 — Session H 스모크 #4와 동일)
  const orders = await fetchStatus("/api/orders", { method: "POST", body: "{}" });
  out.ordersPath = orders.status === 400
    ? "OK"
    : `FAIL(status=${orders.status})`;

  // Stock 서비스: n1.stock.v1 계약 (시트 1순위 → ledger 미러 폴백 — 정직 응답이면 OK)
  const stock = await fetchStatus("/api/stock?sku=PRD-N1-01");
  let stockOk = stock.status === 200;
  try { stockOk = stockOk && JSON.parse(stock.body).contractVersion === "n1.stock.v1"; } catch {}
  out.stockService = stockOk ? "OK" : `FAIL(status=${stock.status})`;

  // HERMES 경로: bridge 상태 관찰 (HERMES는 외부 오케스트레이터 — 재시작 대상이 아니라 관찰 대상)
  // ledger.json 부재 = staging 파이프라인 미실시 상태(전 상품 NOT_STAGED와 동일 맥락) → WARN.
  // FAIL은 구조 파손(디렉토리 소실)이나 기존 ledger 파싱 실패(손상)에만 쓴다.
  const bridge = { ledgerReadable: false, ledgerPresent: false, dirs: false, inboundStale: null };
  try {
    bridge.ledgerPresent = fs.existsSync(LEDGER);
    bridge.ledgerReadable = bridge.ledgerPresent
      ? Boolean(JSON.parse(fs.readFileSync(LEDGER, "utf8")))
      : false;
    bridge.dirs = ["inbound", "outbound", "escalations"].every((d) =>
      fs.existsSync(path.join(ROOT, "mission-20260909", "N1_STOCK_BRIDGE", d)));
    if (fs.existsSync(BRIDGE_INBOUND)) {
      const stale = fs.readdirSync(BRIDGE_INBOUND)
        .filter((f) => f.startsWith("probe-result-") && f.endsWith(".json"))
        .map((f) => fs.statSync(path.join(BRIDGE_INBOUND, f)).mtimeMs)
        .filter((m) => Date.now() - m > INBOUND_STALE_MS);
      bridge.inboundStale = stale.length;
    }
    out.hermesBridge = !bridge.dirs
      ? "FAIL(bridge 디렉토리 소실)"
      : bridge.ledgerPresent && !bridge.ledgerReadable
        ? "FAIL(ledger 파싱 실패 — 손상 의심)"
        : !bridge.ledgerPresent
          ? "WARN(ledger 미생성 — HERMES staging 전 상태, 정상 경로)"
          : bridge.inboundStale > 0
            ? `WARN(inbound ${bridge.inboundStale}건 ${INBOUND_STALE_MS / 60000}분+ 정체)`
            : "OK";
  } catch (e) {
    out.hermesBridge = `FAIL(${e.message})`;
  }

  // Telegram 경로: 구성 존재만 판정 — 프로브로 메시지를 보내지 않는다 (spam 원천 차단)
  const tgOk = Boolean((process.env.N1_CS_BOT_TOKEN || "").trim() && (process.env.N1_CS_CHAT_ID || "").trim());
  out.telegramPath = tgOk ? "OK(configured)" : "UNCONFIGURED";
  return out;
}

// --- 메인 루프 ----------------------------------------------------------------------------
let lastDeep = { at: 0, results: null };
let lastLivenessDown = false;
const componentWasDown = {};
const deepFailStrikes = {};

async function checkOnce() {
  const { appOk, storefrontOk, health } = await livenessProbe();
  const now = Date.now();

  if (!appReadyOnce) {
    if (appOk && storefrontOk) {
      appReadyOnce = true;
      hungStrikes = 0;
      log("INFO", "첫 readiness 성립 — liveness 실패 판정·deep check 활성");
    } else if (!stopping && child && Date.now() - childStartedAt > WARMUP_LIMIT_MS) {
      // 포트는 점유했는데 readiness가 끝내 성립하지 않는 경우(예: 500 루프) —
      // 게이트가 영구 웜업에 갇혀 재시작·알림이 없는 구멍을 막는다 (2026-09-09 실측).
      log("ERROR", `웜업 한도 ${WARMUP_LIMIT_MS / 1000}s 초과 — 기동 실패 판정, 프로세스 재기동`);
      sendAlert("app", "CRITICAL",
        `기동 실패: spawn 후 ${WARMUP_LIMIT_MS / 1000}초 내 readiness 미성립 — 재기동 시도 (빌드/포트/디스크 확인 요망)`);
      killTree();
      return { appOk, storefrontOk, deep: lastDeep.results, warmup: "timeout" };
    } else {
      log("INFO", `웜업 대기 — readiness 미성립 (storefront:${storefrontOk ? 200 : "down"} app/api:${appOk ? 200 : "down"}), 실패 카운트·deep check 보류`);
      return { appOk, storefrontOk, deep: lastDeep.results, warmup: true };
    }
  }

  if (appOk && storefrontOk) {
    hungStrikes = 0;
    if (lastLivenessDown) {
      lastLivenessDown = false;
      lastLivenessDownAlertAt = 0;
      sendAlert("app", "RECOVERED",
        `서비스 복구 — HTTP liveness 정상 복귀 (pid=${child?.pid ?? "?"}, 누적 재시작 ${state.totalRestarts})`);
    }
  } else if (!stopping) {
    hungStrikes += 1;
    const detail = `liveness 실패 (${hungStrikes}/${HUNG_STRIKES}) — storefront:${storefrontOk ? 200 : "down"} app/api:${appOk ? 200 : "down"} ${health.body.slice(0, 80)}`;
    log("WARN", detail);
    // alert은 30초(hung strike 소진) 시점 1회 — 매 프로브마다 보내지 않는다
    if (hungStrikes >= HUNG_STRIKES && now - lastLivenessDownAlertAt > ALERT_COOLDOWN_MS) {
      lastLivenessDownAlertAt = now;
      lastLivenessDown = true;
      sendAlert("app", "CRITICAL", `HTTP ${HUNG_STRIKES}회 연속 실패 — hang 판정, 프로세스 재기동: ${detail}`);
      killTree(); // exit 핸들러가 restart 스케줄
    }
  }

  // SLOW readiness — FAIL은 연속 2회부터 알린다 (외부 의존(Sheets 등)의 일회성 블립을
  // CRITICAL로 승격시키지 않기 위함 — 2026-09-09 기동 직후 1회성 실패 기록 실측 반영)
  if (now - lastDeep.at >= OPT.deepIntervalMs) {
    const results = await deepChecks();
    lastDeep = { at: now, results };
    for (const [component, verdict] of Object.entries(results)) {
      const failing = typeof verdict === "string" && verdict.startsWith("FAIL");
      const warning = typeof verdict === "string" && verdict.startsWith("WARN");
      if (failing) {
        deepFailStrikes[component] = (deepFailStrikes[component] || 0) + 1;
        log("WARN", `deep[${component}] FAIL (${deepFailStrikes[component]}/2): ${verdict}`);
        if (deepFailStrikes[component] >= 2) {
          sendAlert(component, "CRITICAL", `readiness 연속 실패: ${verdict}`);
          componentWasDown[component] = true;
        }
      } else {
        deepFailStrikes[component] = 0;
        if (componentWasDown[component]) {
          componentWasDown[component] = false;
          sendAlert(component, "RECOVERED", `readiness 복구: ${verdict}`);
        } else if (warning) {
          log("WARN", `deep[${component}] ${verdict}`); // WARN은 alert 아님 — 로그만
        }
      }
    }
    log("INFO", `deep checks: ${JSON.stringify(results)}`);
  }
  return { appOk, storefrontOk, deep: lastDeep.results };
}

async function main() {
  fs.mkdirSync(LOGDIR, { recursive: true });
  log("INFO", `supervisor 시작 pid=${process.pid} port=${OPT.port} interval=${OPT.intervalMs}ms deep=${OPT.deepIntervalMs}ms dryRun=${OPT.dryRun}`);

  if (OPT.selftest) {
    runSelftest();
    return;
  }

  if (OPT.testAlert) {
    // spam-guard를 의도적으로 우회하는 유일한 경로 — 채널 수신 육안 확인용 (조치 불요)
    if (OPT.dryRun) { log("INFO", "[dry-run] [N1 TEST] alert 경로 검증 메시지 — 채널 대신 로그 출력"); return; }
    const send = loadTelegramSender();
    const token = (process.env.N1_CS_BOT_TOKEN || "").trim();
    const chat = (process.env.N1_CS_CHAT_ID || "").trim();
    if (!send || !token || !chat) { log("ERROR", "telegram 미구성 — 발송 불가 (ok:false, 정직 보고)"); process.exit(1); }
    const r = await send(token, chat, "[N1 TEST] alert 경로 검증 메시지입니다 — 조치 불요 (supervisor --test-alert)");
    log(r.ok ? "INFO" : "ERROR", `테스트 발송 ok:${r.ok}`);
    process.exit(r.ok ? 0 : 1);
  }

  // lock은 감시 루프 모드에만 관련 — --once(외부 프로브)·--selftest는 감시 인스턴스와 무관하다
  if (OPT.once) {
    await new Promise((r) => setTimeout(r, 2500)); // 초기 웜업
    const r = await checkOnce();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.appOk && r.storefrontOk ? 0 : 1);
  }

  // 단일 인스턴스 가드 — 이중 supervisor는 포트 쟁탈로 자식이 code=1 반복 사망하는
  // crash-loop 오탐을 만든다 (2026-09-09 실측 사례). 살아있는 lock이 있으면 기동을 거부한다.
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockPid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
      let alive = false;
      try { alive = Number.isFinite(lockPid) && process.kill(lockPid, 0); } catch { alive = false; }
      if (alive && lockPid !== process.pid) {
        log("ERROR", `이미 supervisor가 구동 중(pid=${lockPid}) — 이중 기동 거부. 종료하려면: taskkill /PID ${lockPid} /T /F`);
        process.exit(3);
      }
      log("WARN", `유실된 lock(pid=${lockPid}, 프로세스 소멸) — 정리 후 계속`);
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  } catch (e) {
    log("ERROR", `lock 파일 처리 실패: ${e.message}`);
    process.exit(3);
  }
  const removeLock = () => { try { if (fs.readFileSync(LOCK_FILE, "utf8").trim() === String(process.pid)) fs.unlinkSync(LOCK_FILE); } catch {} };
  process.on("exit", removeLock);

  const freed = await waitForPortFree(OPT.port, 10000);
  if (!freed) {
    log("ERROR", `port ${OPT.port}가 이미 사용 중 — supervisor 종료 (기존 프로세스를 대체하지 않는다)`);
    process.exit(2);
  }
  spawnApp();
  saveState();
  process.on("SIGINT", () => {
    log("INFO", "SIGINT — 자식 종료 후 supervisor 종료");
    stopping = true;
    killTree();
    setTimeout(() => process.exit(0), 1500);
  });
  setInterval(checkOnce, OPT.intervalMs);
}

// --- selftest: spam-guard 순수 로직 단언 (네트워크 0, 실전송 0) ----------------------------
// 케이던스 설계: 새 장애 = 즉시 1건. 동일 상태 지속 = cooldown(30분)+duplicate(1h window)로
// 시간당 1회로 수렴. RECOVERED 후 새 장애 = 상태 전이므로 즉시 1건.
function runSelftest() {
  const t0 = 1_000_000_000;
  let s = { alerts: [], lastAlertKey: null };
  const assert = (cond, name) => {
    if (!cond) { console.error(`SELFTEST FAIL: ${name}`); process.exit(1); }
    console.log(`ok: ${name}`);
  };
  let d = alertDecision(s, "app", "CRITICAL", t0);
  assert(d.send, "새 장애는 즉시 발송");
  recordAlert(s, "app", "CRITICAL", t0);
  d = alertDecision(s, "app", "CRITICAL", t0 + 1000);
  assert(!d.send && d.reason === "component-cooldown", "cooldown 내 중복 억제");
  d = alertDecision(s, "app", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 1);
  assert(!d.send && d.reason === "duplicate", "동일 상태 지속은 rate-window 내 duplicate 억제 (시간당 1회 케이던스)");
  recordAlert(s, "app", "RECOVERED", t0 + ALERT_COOLDOWN_MS + 2);
  d = alertDecision(s, "app", "RECOVERED", t0 + ALERT_COOLDOWN_MS + 3);
  assert(d.send, "RECOVERED는 cooldown 면제");
  d = alertDecision(s, "app", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 4);
  assert(d.send, "복구 후 새 장애는 상태 전이로 즉시 발송");
  recordAlert(s, "app", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 4);
  recordAlert(s, "ordersPath", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 5);
  d = alertDecision(s, "hermesBridge", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 6);
  assert(d.send, "컴포넌트 분리 — 다른 컴포넌트 장애는 독립 발송");
  recordAlert(s, "hermesBridge", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 6);
  d = alertDecision(s, "telegramPath", "CRITICAL", t0 + ALERT_COOLDOWN_MS + 7);
  assert(!d.send && d.reason === "global-rate-cap", `시간당 ${ALERT_RATE_MAX}건 상한 억제`);
  d = alertDecision(s, "app", "CRITICAL", t0 + ALERT_RATE_WINDOW_MS + ALERT_COOLDOWN_MS + 1);
  assert(d.send, "rate window + cooldown 모두 경과 후 재발송");
  console.log("SELFTEST PASS — spam-guard 로직 8/8");
}

main().catch((e) => {
  log("ERROR", `supervisor 치명 오류: ${e.message}`);
  process.exit(1);
});
