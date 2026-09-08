/**
 * [P0] CS 메시지 provenance + guest identity 불변식 테스트 (사고 #B·#C)
 *
 * 사고 #B: 실제 고객이 보내지 않은 "네 감사합니다"가 고객 메시지로 기록될 여지.
 * 사고 #C: 실제 고객 1명인데 비회원 2/3이 생기는 phantom guest.
 *
 * 계약:
 *  - sender↔source 대응 위반 insert는 저장 계층에서 거부된다 (customer ⇔ WEB_CUSTOMER_INPUT만).
 *  - TEST_FIXTURE는 is_test 세션에서만 허용된다.
 *  - guest label은 conversation 생성 시 1회 배정, 이후 불변. 메시지·escalation·재요청·
 *    Telegram 재시도가 새 conversation/새 guest를 만들지 않는다 (get-or-create).
 *  - 운영자 답장은 HUMAN_OPERATOR/TELEGRAM_HUMAN_REPLY provenance로 저장된다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

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

const cs = require('../lib/cs.ts');
const store = require('../lib/csStore.ts');
const engine = require('../lib/csEngine.ts');

// 테스트 환경: Telegram 전송 없음 (토큰 미설정), 인증 채널은 상수
process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '4242';
delete process.env.N1_CS_TEST_MODE;

function resetStore() {
  const st = store.getStore();
  st.sessions = {};
  st.counter = 0;
  st.guestCounter = 0;
  st.messageCounter = 0;
  st.telegram.seenUpdates.clear();
  st.telegram.seenMessages.clear();
}

// ── 사고 #B: provenance 위반 insert 거부
test('provenance guard rejects customer message with non-web sources', () => {
  resetStore();
  const sess = store.ensureSession(store.getStore(), 'CS-P01');
  assert.throws(() => store.appendMessage(sess, 'customer', '위조 시도', 'TELEGRAM_HUMAN_REPLY'));
  assert.throws(() => store.appendMessage(sess, 'customer', '위조 시도', 'AI_GENERATION'));
  assert.throws(() => store.appendMessage(sess, 'customer', '위조 시도', 'SYSTEM_EVENT'));
  // 위조 시도가 저장되지 않았는지 확인
  assert.equal(sess.messages.filter((m) => m.text === '위조 시도').length, 0);
});

test('provenance guard rejects TEST_FIXTURE in live sessions and allows only in is_test', () => {
  resetStore();
  const live = store.ensureSession(store.getStore(), 'CS-P02');
  assert.throws(() => store.appendMessage(live, 'customer', 'fixture', 'TEST_FIXTURE'));
  const testSession = store.ensureSession(store.getStore(), 'CS-P03');
  testSession.isTest = true;
  const msg = store.appendMessage(testSession, 'customer', 'fixture', 'TEST_FIXTURE');
  assert.equal(msg.source, 'TEST_FIXTURE');
});

test('web customer input and operator reply carry exact provenance and correlation ids', () => {
  resetStore();
  const sess = store.ensureSession(store.getStore(), 'CS-P04');
  const customerMsg = store.appendWebCustomerMessage(sess, '네 감사합니다.');
  assert.equal(customerMsg.role, 'customer');
  assert.equal(customerMsg.source, 'WEB_CUSTOMER_INPUT');

  const operatorMsg = store.appendHumanOperatorMessage(sess, '원문 그대로 전달합니다.', {
    updateId: 777001,
    messageId: 888,
    replyToMessageId: 14,
  });
  assert.equal(operatorMsg.role, 'agent');
  assert.equal(operatorMsg.source, 'TELEGRAM_HUMAN_REPLY');
  assert.equal(operatorMsg.text, '원문 그대로 전달합니다.'); // verbatim
  assert.equal(operatorMsg.telegram.updateId, 777001);
  assert.equal(operatorMsg.telegram.messageId, 888);
  assert.equal(operatorMsg.telegram.replyToMessageId, 14);

  const aiMsg = store.appendAiMessage(sess, 'AI 응답');
  assert.equal(aiMsg.source, 'AI_GENERATION');
  const sysMsg = store.appendSystemMessage(sess, '시스템 안내');
  assert.equal(sysMsg.source, 'SYSTEM_EVENT');

  // message_id 유일·순차 (§4 provenance 최소 필드)
  const ids = sess.messages.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
});

// ── 사고 #C: one-guest invariants
test('ten customer messages keep exactly one conversation and one stable guest label', async () => {
  resetStore();
  let sid = null;
  for (let i = 0; i < 10; i++) {
    const r = await engine.handleCustomerMessage(sid, `메시지 ${i + 1}번째 문의드립니다`);
    sid = r.sid;
  }
  const st = store.getStore();
  assert.equal(Object.keys(st.sessions).length, 1);
  const sess = st.sessions[sid];
  assert.ok(sess.customer.label.startsWith('비회원'));
  assert.equal(st.guestCounter, 1); // 10 메시지 = guest 1명
  assert.equal(sess.messages.filter((m) => m.role === 'customer').length, 10);
});

test('escalation, follow-ups and repeats never allocate a new guest or conversation', async () => {
  resetStore();
  const r1 = await engine.handleCustomerMessage(null, '안녕하세요');
  const r2 = await engine.handleCustomerMessage(r1.sid, '이 주문 취소하고 싶어요'); // escalation (주문 컨텍스트 없어도 취소 의사는 경계)
  const r3 = await engine.handleCustomerMessage(r2.sid, '상담원 연결해줘'); // HUMAN_* 진입
  const r4 = await engine.handleCustomerMessage(r3.sid, '추가 문의입니다'); // 후속
  const st = store.getStore();
  assert.equal(Object.keys(st.sessions).length, 1);
  assert.equal(st.guestCounter, 1);
  assert.equal(new Set([r1.sid, r2.sid, r3.sid, r4.sid]).size, 1);
  const sess = st.sessions[r1.sid];
  assert.equal(sess.conversationSource, 'WEB_CUSTOMER_SESSION');
  // guest label 불변 (§43 INVARIANT 4)
  assert.ok(sess.customer.label.startsWith('비회원'));
});

test('same session id from client reuses the conversation (get-or-create)', async () => {
  resetStore();
  const first = await engine.handleCustomerMessage(null, '안녕하세요');
  const second = await engine.handleCustomerMessage(first.sid, '상품 문의할게요');
  assert.equal(second.sid, first.sid);
  const st = store.getStore();
  assert.equal(Object.keys(st.sessions).length, 1);
  assert.equal(st.guestCounter, 1);
});

// ── 사고 #C 핵심 재현: 첫 응답 전에 몰리는 rapid sends (sid=null × 3) — 세션 키로 1개로 합쳐진다
test('rapid parallel sends with the same session key create exactly one conversation', async () => {
  resetStore();
  const KEY = 'race-key-001';
  const [a, b, c] = await Promise.all([
    engine.handleCustomerMessage(null, '안녕하세요', undefined, KEY),
    engine.handleCustomerMessage(null, '상품 문의할게요', undefined, KEY),
    engine.handleCustomerMessage(null, '상담원 연결해주세요.', undefined, KEY),
  ]);
  const st = store.getStore();
  assert.equal(Object.keys(st.sessions).length, 1); // phantom conversation ZERO
  assert.equal(st.guestCounter, 1); // 비회원 1명
  assert.equal(new Set([a.sid, b.sid, c.sid]).size, 1);
  const sess = st.sessions[a.sid];
  assert.equal(sess.messages.filter((m) => m.role === 'customer').length, 3);
});

test('different session keys create separate conversations (real distinct guests only)', async () => {
  resetStore();
  await engine.handleCustomerMessage(null, '문의 1', undefined, 'key-A');
  await engine.handleCustomerMessage(null, '문의 2', undefined, 'key-B');
  const st = store.getStore();
  assert.equal(Object.keys(st.sessions).length, 2);
  assert.equal(st.guestCounter, 2); // 실제 게스트 2명일 때만 비회원 2명
});

// ── §28/§15: 테스트 세션 isolation 마킹
test('is_test sessions are marked and escalation payload carries the [TEST] prefix', async () => {
  resetStore();
  process.env.N1_CS_TEST_MODE = '1';
  try {
    const r = await engine.handleCustomerMessage(null, '상담원 연결해줘');
    const sess = store.getStore().sessions[r.sid];
    assert.equal(sess.isTest, true);
    const payload = engine.buildTranscriptPayload(sess, '고객이 상담원을 명시적으로 요청');
    assert.ok(payload.startsWith('[TEST] [N°1 전문상담 요청]'));
    assert.ok(cs.testPrefix(true) === '[TEST] ');
    assert.ok(cs.testPrefix(false) === '');
  } finally {
    delete process.env.N1_CS_TEST_MODE;
  }
  // 라이브 모드 복귀 확인
  const live = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  assert.equal(store.getStore().sessions[live.sid].isTest, false);
  const livePayload = engine.buildTranscriptPayload(store.getStore().sessions[live.sid], '고객이 상담원을 명시적으로 요청');
  assert.ok(livePayload.startsWith('[N°1 전문상담 요청]'));
  assert.ok(!livePayload.includes('[TEST]'));
});

// ── 운영자 답장이 절대 customer가 아님을 릴레이 경로에서 재확인 (사고 #B × #A 결합)
test('operator reply is stored as HUMAN_OPERATOR provenance, never as customer', async () => {
  resetStore();
  const relay = require('../lib/csRelay.ts');
  const r = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  const sess = store.getStore().sessions[r.sid];
  sess.telegramMsgIds.push(321);
  const outcome = await relay.processTelegramUpdate({
    update_id: 700001,
    message: {
      message_id: 700,
      text: '확인했습니다 고객님.',
      chat: { id: '4242' },
      reply_to_message: { message_id: 321 },
    },
  });
  assert.equal(outcome.delivered, true);
  const stored = sess.messages[sess.messages.length - 1];
  assert.equal(stored.role, 'agent');
  assert.equal(stored.source, 'TELEGRAM_HUMAN_REPLY');
  assert.equal(stored.text, '확인했습니다 고객님.');
  assert.equal(sess.messages.filter((m) => m.role === 'customer' && m.text === '확인했습니다 고객님.').length, 0);
});
