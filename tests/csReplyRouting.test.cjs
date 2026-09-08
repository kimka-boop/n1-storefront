/**
 * [P0] Telegram reply-to conversation routing 테스트 (미션 §2·§5·§9·§13·§14·§15·§17)
 *
 * 핵심 계약:
 *   - reply_to_message.message_id → conversation 매핑이 유일한 라우팅 근거
 *   - standalone 운영자 메시지는 유일한 활성 대화가 있어도 어디로도 전달 금지
 *   - 미매핑 reply 전달 금지 / 미인가 발신 무시 / 중복 update·message 이중 전달 금지
 *   - 동시 3개 conversation cross-delivery 0
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → lib/*.ts
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

const store = require('../lib/csStore.ts');
const relay = require('../lib/csRelay.ts');
const engine = require('../lib/csEngine.ts');

// 토큰 없음 → 운영자 채널 응답(안내·확인)은 no-op. 라우팅 로직은 그대로 검증된다.
process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '777';
delete process.env.N1_CS_OPERATOR_IDS;

let updateSeq = 1000;
let messageSeq = 5000;

function resetStore() {
  const st = store.getStore();
  st.sessions = {};
  st.counter = 0;
  st.guestCounter = 0;
  st.telegram.seenUpdates.clear();
  st.telegram.seenMessages.clear();
}

/** escalation 상태(HUMAN_PENDING)까지 진행 + 전송 성공 시 기록될 앵커 id 시뮬레이션 */
async function escalatedSession(sid, customer) {
  const r = await engine.handleCustomerMessage(sid, '상담원 연결해줘', customer);
  assert.equal(r.escalated, true);
  const sess = store.getStore().sessions[r.sid];
  return sess;
}

function operatorReply(text, replyTo, { chatId = '777', fromId, mid } = {}) {
  updateSeq += 1;
  messageSeq += 1;
  const message = { message_id: mid ?? messageSeq, text, chat: { id: chatId } };
  if (fromId) message.from = { id: fromId };
  if (replyTo) message.reply_to_message = { message_id: replyTo };
  return { update_id: updateSeq, message };
}

function agentTexts() {
  const st = store.getStore();
  const out = [];
  for (const s of Object.values(st.sessions)) {
    for (const m of s.messages) if (m.role === 'agent') out.push({ sid: s.id, text: m.text });
  }
  return out;
}

// ── §5: standalone 메시지 — 활성 대화 0개
test('standalone message with no active conversations delivers to nobody', async () => {
  resetStore();
  const r = await relay.processTelegramUpdate(operatorReply('아무 고객 테스트', null));
  assert.equal(r.delivered, false);
  assert.ok(agentTexts().length === 0);
});

// ── §5: standalone 메시지 — 활성 대화가 정확히 1개여도 절대 자동 전달 금지 (P0)
test('standalone message with exactly one pending conversation still delivers to nobody', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  assert.equal(sess.status, 'HUMAN_PENDING');
  const r = await relay.processTelegramUpdate(operatorReply('혼자 남은 대화로 가면 안 되는 메시지', null));
  assert.equal(r.delivered, false);
  assert.deepEqual(agentTexts(), []); // 유일한 대화에도 전달되지 않는다
});

// ── §10·§22: 동시 3개 conversation — cross-delivery 0
test('three concurrent conversations: each reply lands only in its own conversation', async () => {
  resetStore();
  const a = await escalatedSession(null); // 비회원 (게스트)
  const b = await escalatedSession(null, { member: true, email: 'member-b@n1.test' }); // 회원 B
  const c = await escalatedSession(null); // 비회원 2
  a.telegramMsgIds.push(101);
  b.telegramMsgIds.push(102);
  c.telegramMsgIds.push(103);
  assert.equal(a.customer.type, 'GUEST');
  assert.equal(b.customer.type, 'MEMBER');

  const ra = await relay.processTelegramUpdate(operatorReply('답변 A', 101));
  const rb = await relay.processTelegramUpdate(operatorReply('답변 B', 102));
  const rc = await relay.processTelegramUpdate(operatorReply('답변 C', 103));
  assert.equal(ra.delivered, true);
  assert.equal(rb.delivered, true);
  assert.equal(rc.delivered, true);

  assert.deepEqual(a.messages.filter((m) => m.role === 'agent').map((m) => m.text), ['답변 A']);
  assert.deepEqual(b.messages.filter((m) => m.role === 'agent').map((m) => m.text), ['답변 B']);
  assert.deepEqual(c.messages.filter((m) => m.role === 'agent').map((m) => m.text), ['답변 C']);

  // cross-delivery 0 — 어떤 대화에도 남의 답변이 없다
  assert.equal(agentTexts().filter((x) => x.text === '답변 A').length, 1);
  assert.equal(agentTexts().filter((x) => x.text === '답변 B').length, 1);
  assert.equal(agentTexts().filter((x) => x.text === '답변 C').length, 1);
  assert.equal(agentTexts().length, 3);

  // §11 — 첫 성공 전달로 HUMAN_ACTIVE 전환
  assert.equal(a.status, 'HUMAN_ACTIVE');
  assert.equal(b.status, 'HUMAN_ACTIVE');
  assert.equal(c.status, 'HUMAN_ACTIVE');
});

// ── §14: 미매핑 메시지에 대한 reply
test('reply to an unmapped message id delivers to nobody', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(201);
  const r = await relay.processTelegramUpdate(operatorReply('잘못된 대상 메시지', 999999));
  assert.equal(r.delivered, false);
  assert.deepEqual(agentTexts(), []);
});

// ── §14·§15: authorized 채널 외부 발신은 매핑이 맞아도 무시
test('reply from a foreign chat id is ignored even with a valid mapping', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(301);
  const r = await relay.processTelegramUpdate(operatorReply('외부인 메시지', 301, { chatId: '999' }));
  assert.equal(r.delivered, false);
  assert.equal(r.handled, false);
  assert.deepEqual(agentTexts(), []);
});

// ── §15: N1_CS_OPERATOR_IDS 설정 시 발신자 id까지 확인
test('operator allowlist restricts relaying to configured sender ids', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(401);
  process.env.N1_CS_OPERATOR_IDS = '111,222';
  try {
    const rejected = await relay.processTelegramUpdate(operatorReply('허용되지 않은 발신자', 401, { fromId: 333 }));
    assert.equal(rejected.delivered, false);
    const allowed = await relay.processTelegramUpdate(operatorReply('허용된 발신자', 401, { fromId: 222 }));
    assert.equal(allowed.delivered, true);
    assert.deepEqual(sess.messages.filter((m) => m.role === 'agent').map((m) => m.text), ['허용된 발신자']);
  } finally {
    delete process.env.N1_CS_OPERATOR_IDS;
  }
});

// ── §17: 동일 update_id 재처리 금지
test('duplicate update_id does not duplicate delivery', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(501);
  updateSeq += 1;
  messageSeq += 1;
  const first = await relay.processTelegramUpdate({
    update_id: updateSeq,
    message: { message_id: messageSeq, text: '한 번만 전달', chat: { id: '777' }, reply_to_message: { message_id: 501 } },
  });
  assert.equal(first.delivered, true);
  // Telegram이 같은 update를 재전송했다 (message_id 동일)
  const replay = await relay.processTelegramUpdate({
    update_id: updateSeq,
    message: { message_id: messageSeq, text: '한 번만 전달', chat: { id: '777' }, reply_to_message: { message_id: 501 } },
  });
  assert.equal(replay.delivered, false);
  assert.equal(agentTexts().filter((x) => x.text === '한 번만 전달').length, 1);
});

// ── §17: update_id는 다르지만 message_id가 같은 재도착도 이중 전달 금지
test('same message_id arriving in a different update is not delivered twice', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(601);
  updateSeq += 1;
  const mid = ++messageSeq;
  await relay.processTelegramUpdate(operatorReply('중복 방지 답변', 601, { mid }));
  const second = await relay.processTelegramUpdate(operatorReply('중복 방지 답변', 601, { mid })); // 새 update, 같은 message
  assert.equal(second.delivered, false);
  assert.equal(agentTexts().filter((x) => x.text === '중복 방지 답변').length, 1);
});

// ── §12·§13: 후속 알림까지 매핑 — 대화 관련 message면 무엇에 답장해도 같은 고객
test('replying to a later conversation update routes to the same conversation', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(701, 709, 793); // escalation 앵커 + 고객 후속 알림 2건 (패밀리)
  const r1 = await relay.processTelegramUpdate(operatorReply('패밀리 답변 1', 709));
  const r2 = await relay.processTelegramUpdate(operatorReply('패밀리 답변 2', 793));
  assert.equal(r1.delivered, true);
  assert.equal(r2.delivered, true);
  assert.deepEqual(sess.messages.filter((m) => m.role === 'agent').map((m) => m.text), ['패밀리 답변 1', '패밀리 답변 2']);
  assert.equal(agentTexts().length, 2); // 다른 대화 없음
});

// ── §4·§20: multiline 원문 verbatim (trim/정규화 없음)
test('multiline operator text is stored verbatim including leading and trailing whitespace', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(801);
  const raw = '안녕하세요.\n\n확인 결과 교환 가능합니다.\n아래 두 가지만 준비해주세요.\n\n1. 상품\n2. 포장  ';
  const r = await relay.processTelegramUpdate(operatorReply(raw, 801));
  assert.equal(r.delivered, true);
  const last = sess.messages[sess.messages.length - 1];
  assert.equal(last.text, raw); // 개행·공백 포함 원문 그대로
});

// ── §6·§7·§8: escalation 요청 포맷 + CS-NNN conversation id + 게스트 label 안정성
test('escalation payload uses the operator request format with CS-NNN conversation id', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '안녕하세요 교환하고 싶어요 상담원 연결해주세요');
  assert.match(r.sid, /^CS-\d{3}$/);
  const sess = store.getStore().sessions[r.sid];
  const payload = engine.buildTranscriptPayload(sess, '고객이 상담원을 명시적으로 요청');
  assert.ok(payload.startsWith('[N°1 전문상담 요청]'));
  assert.ok(payload.includes('고객:\n비회원'));
  assert.ok(payload.includes(`Conversation:\n${r.sid}`));
  assert.ok(payload.includes('상태:\nHUMAN_PENDING'));
  assert.ok(payload.includes('──── 전체 대화 ────'));
  assert.ok(payload.includes("'답장(Reply)'"));
  // 주문 컨텍스트 없으면 관련 주문 블록 생략
  assert.ok(!payload.includes('관련 주문'));
});

// ── §11: HUMAN_ACTIVE에서 고객 후속 — AI 침묵 유지
test('customer follow-up in HUMAN_ACTIVE gets no AI reply', async () => {
  resetStore();
  const sess = await escalatedSession(null);
  sess.telegramMsgIds.push(901);
  await relay.processTelegramUpdate(operatorReply('먼저 답변드립니다', 901));
  assert.equal(sess.status, 'HUMAN_ACTIVE');
  const before = sess.messages.length;
  const r = await engine.handleCustomerMessage(sess.id, '네 알겠습니다.');
  assert.equal(r.reply, null);
  assert.equal(r.status, 'HUMAN_ACTIVE');
  const last = sess.messages[sess.messages.length - 1];
  assert.equal(last.role, 'customer');
  assert.equal(last.text, '네 알겠습니다.');
  assert.equal(sess.messages.length, before + 1); // AI/system 메시지 추가 없음
});

// ── §5: standalone에 대한 봇 안내 문구 계약
test('standalone and unmapped replies produce the operator guidance texts', async () => {
  resetStore();
  const standalone = await relay.processTelegramUpdate(operatorReply('답장 없는 메시지', null));
  assert.equal(standalone.info, 'standalone — 전달 없음');
  const unmapped = await relay.processTelegramUpdate(operatorReply('답장했지만 매핑 없음', 424242));
  assert.equal(unmapped.info, '미매핑 reply — 전달 없음');
  assert.deepEqual(agentTexts(), []);
});
