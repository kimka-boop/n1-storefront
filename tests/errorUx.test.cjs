/**
 * [SESSION L · TASK 29] ERROR UX — failure matrix 잠금 테스트
 *
 * 잠금 대상:
 *  L1  고객 응답 실패 위생(lib/errorSanitize) — 계약 오류(4xx)만 통과, 나머지는
 *      고정 문구 + 502. 내부 예외 원문이 고객에게 가지 않는다.
 *  L2  Telegram 전달 실패 escalation — "전달됩니다" 거짓 안내 금지.
 *      전송 실패 시 접수 사실 + 재시도 방법만 안내한다.
 *  L3  Telegram 전달 성공 escalation — 전달이 실제로 된 경우에만 완료형 안내.
 *  L4  소스 잠금 — app/api 라우트 catch가 raw e.message를 고객 응답에 쓰지 않는다.
 *  L5  소스 잠금 — 고객 응답 경계에 내부 저장소 이름("시트 없음") 노출 금지.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → worktree lib/*.ts (cs.test.cjs와 동일 적재 방식)
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(__dirname, '..', request.slice(2)) + '.ts';
  }
  return origResolve.call(this, request, ...args);
};
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(code, filename);
};

const sanitize = require('../lib/errorSanitize.ts');
const cs = require('../lib/cs.ts');
const store = require('../lib/csStore.ts');
const engine = require('../lib/csEngine.ts');

// L2/L3 기본 환경: 텔레그램 토큰 없음 → 전송 실패가 정상 경로 (성공 케이스는 L3에서 fetch stub)
process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '4242';

function freshSession(sid = '#SESS_LX_1') {
  delete store.getStore().sessions[sid];
  return store.ensureSession(store.getStore(), sid);
}

// ── L1: 고객 응답 실패 위생 ──
test('L1: contract 4xx errors pass through with their truthful message', () => {
  const contract = Object.assign(new Error('재고 부족 — 수량을 조정해 주세요'), { status: 409 });
  const r = sanitize.clientSafeFailure(contract);
  assert.equal(r.status, 409);
  assert.equal(r.message, '재고 부족 — 수량을 조정해 주세요');

  const notFound = Object.assign(new Error('주문 없음'), { status: 404 });
  assert.equal(sanitize.clientSafeFailure(notFound).status, 404);
});

test('L1: unexpected errors become 502 + fixed copy, never raw internals', () => {
  // Google API 오류 원문 시나리오
  const googleErr = new Error('GoogleSpreadsheet: permission denied for spreadsheet id ABC-123');
  const r1 = sanitize.clientSafeFailure(googleErr);
  assert.equal(r1.status, 502);
  assert.equal(r1.message, sanitize.GENERIC_UPSTREAM_MESSAGE);
  assert.ok(!r1.message.includes('GoogleSpreadsheet'));
  assert.ok(!r1.message.includes('ABC-123'));

  // 500 상태를 단 throw도 고정 문구로 치환된다 (내부 문구 유출 차단)
  const internal = Object.assign(new Error('Orders 시트 없음'), { status: 500 });
  const r2 = sanitize.clientSafeFailure(internal);
  assert.equal(r2.status, 502);
  assert.equal(r2.message, sanitize.GENERIC_UPSTREAM_MESSAGE);

  // non-Error throw
  const r3 = sanitize.clientSafeFailure('boom');
  assert.equal(r3.status, 502);
  assert.equal(r3.message, sanitize.GENERIC_UPSTREAM_MESSAGE);

  // 고정 문구 자체가 금지 토큰을 담지 않는다
  for (const banned of ['500', 'undefined', 'null', 'Error']) {
    assert.ok(!sanitize.GENERIC_UPSTREAM_MESSAGE.includes(banned), `fixed copy must not contain ${banned}`);
  }
});

// ── L2: Telegram 전달 실패 escalation — 거짓 "전달" 안내 금지 ──
test('L2: escalation with unreachable Telegram never claims transcript delivery', async () => {
  const sess = freshSession('#SESS_L_FAIL');
  const r = await engine.handleCustomerMessage(sess.id, '상담원 연결해줘');

  // 접수 자체는 정상 — 연결 요청 상태(HUMAN_PENDING)는 유지된다 (재시도 훅 보존)
  assert.equal(r.escalated, true);
  assert.equal(r.status, 'HUMAN_PENDING');

  // 고객에게 내려가는 안내는 완료형 전달 문구가 아니다
  assert.equal(r.reply, cs.ESCALATION_DELIVERY_PENDING_NOTICE);
  assert.ok(r.reply.includes('전문 상담원'), '고객 안내는 상태를 정확히 표현');
  assert.ok(!r.reply.includes('전달됩니다'), '전달 실패에 "전달됩니다" 금지');
  assert.ok(!r.reply.includes('연결 완료'), '전달 실패에 "연결 완료" 금지');

  // 대화 기록(system 메시지)에도 같은 정직 문구가 남는다 — 위젯은 전사본을 렌더한다
  const systemMsgs = sess.messages.filter((m) => m.role === 'system');
  assert.ok(systemMsgs.length >= 1);
  assert.equal(systemMsgs[systemMsgs.length - 1].text, cs.ESCALATION_DELIVERY_PENDING_NOTICE);
});

// ── L3: 전송 성공 escalation — 실제 전달이 된 경우에만 완료형 안내 ──
test('L3: escalation with successful Telegram send keeps the delivery notice', async () => {
  const realFetch = global.fetch;
  let sendCalls = 0;
  global.fetch = async () => {
    sendCalls += 1;
    return { ok: true, json: async () => ({ result: { message_id: 9900 + sendCalls } }) };
  };
  try {
    process.env.N1_CS_BOT_TOKEN = 'TEST_TOKEN';
    const sess = freshSession('#SESS_L_OK');
    const r = await engine.handleCustomerMessage(sess.id, '상담원 연결해줘');
    assert.equal(r.escalated, true);
    assert.equal(r.status, 'HUMAN_PENDING');
    assert.equal(r.reply, cs.ESCALATION_NOTICE); // 전송이 실제로 성공했으므로 전달 안내는 사실
    assert.ok(sendCalls >= 1, 'Telegram 전송이 시도되어야 한다');
    assert.ok(sess.telegramMsgIds.includes(9901), '성공 청크는 conversation에 매핑된다');
  } finally {
    process.env.N1_CS_BOT_TOKEN = '';
    global.fetch = realFetch;
  }
});

// ── L4: 소스 잠금 — 라우트 catch의 raw e.message 유출 금지 ──
test('L4: no api route passes raw exception text to the client', () => {
  const apiDir = path.join(__dirname, '..', 'app', 'api');
  const routes = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') routes.push(full);
    }
  })(apiDir);
  assert.ok(routes.length >= 10, `routes discovered: ${routes.length}`);

  const banned = [
    /e instanceof Error \? e\.message/,   // 고전 유출 패턴
    /error: message/,                     // message 변수 그대로 응답
    /\.stack/,                            // 스택 트레이스
  ];
  for (const file of routes) {
    const src = fs.readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      // 서버 로그(console.*)의 예외 기록은 합법이다 — 고객 응답 본문만 잠근다
      if (line.trim().startsWith('console.')) continue;
      for (const b of banned) {
        assert.ok(!b.test(line), `${path.relative(path.join(__dirname, '..'), file)} leaks raw error text: ${line.trim().slice(0, 80)}`);
      }
    }
  }
});

// ── L5: 소스 잠금 — 내부 저장소 이름 노출 금지 ──
test('L5: no customer-facing error message names the internal store', () => {
  const targets = [
    path.join(__dirname, '..', 'app', 'api', 'orders', 'route.ts'),
    path.join(__dirname, '..', 'app', 'api', 'orders', 'confirm', 'route.ts'),
  ];
  for (const file of targets) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!src.includes('Orders 시트 없음'), `${path.basename(file)} must not leak store names to thrown customer messages`);
  }
});
