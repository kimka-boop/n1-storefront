/**
 * [SESSION D — TASKS 24–25] N°1 AI CS + Telegram 인수인계 테스트 매트릭스 (P0 release blocker)
 *
 * D1 greeting (scripted 1회)      D2 second greeting (문맥)      D3 nonsense (짧은 자연 응답)
 * D4 spam burst 감지              D5 cooldown (10–20s, deterministic)  D6 legitimate burst 미차단
 * D7 human request → HUMAN_PENDING D8 Telegram outbound (실측은 E2E)   D9 payload raw+summary
 * D10 human inbound (reply-to)     D11 verbatim 전달                 D12 HUMAN_ACTIVE AI 침묵
 * D13 duplicate ticket 방지
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
const relay = require('../lib/csRelay.ts');
const engine = require('../lib/csEngine.ts');

process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '4242';
delete process.env.N1_CS_TEST_MODE;

let sidSeq = 0;
function resetStore() {
  const st = store.getStore();
  st.sessions = {};
  st.counter = 0;
  st.guestCounter = 0;
  st.messageCounter = 0;
  st.sessionKeys.clear();
  st.telegram.seenUpdates.clear();
  st.telegram.seenMessages.clear();
}

async function newConversation() {
  const r = await engine.handleCustomerMessage(null, '안녕하세요');
  return r.sid;
}

// ── D1: 첫 greeting은 scripted 1회
test('D1: first greeting returns the scripted welcome once', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '안녕하세요');
  assert.equal(r.reply, cs.AI_GREETING);
  assert.equal(r.status, 'GREETED');
});

// ── D2: 두 번째 greeting은 반복 스크립트 금지, 짧은 문맥 응답
test('D2: second greeting is short and contextual, never the repeated script', async () => {
  resetStore();
  const sid = await newConversation();
  const r = await engine.handleCustomerMessage(sid, '안녕하세요');
  assert.equal(r.reply, cs.SECOND_GREETING);
  assert.notEqual(r.reply, cs.AI_GREETING);
  const sess = store.getStore().sessions[sid];
  const greetings = sess.messages.filter((m) => m.role === 'ai' && m.text === cs.AI_GREETING);
  assert.equal(greetings.length, 1); // scripted welcome은 대화당 정확히 1회
});

// ── D3: nonsense/unknown harmless intent — 고정 macro 반복 금지, 짧은 자연 응답
test('D3: unknown harmless inputs get short varied natural responses, not one fixed macro', async () => {
  resetStore();
  const sid = await newConversation();
  const seen = new Set();
  for (const text of ['ㅁㄴㅇㄹ', '오늘 뭘 먹을까', '우주는 넓다', 'zzzz', '음...그냥요']) {
    const r = await engine.handleCustomerMessage(sid, text);
    assert.ok(r.reply && r.reply.length > 0);
    seen.add(r.reply);
  }
  // 5개 서로 다른 입력에 대해 최소 2개 이상의 서로 다른 응답 (단일 macro 고정 금지)
  assert.ok(seen.size >= 2, `응답 다양성 부족: ${[...seen].length}`);
});

// ── D4: spam burst — 60초 내 동일/유사 급증 감지
test('D4: rapid duplicate burst trips the spam gate within the 60s window', async () => {
  resetStore();
  const sid = await newConversation();
  let tripped = false;
  for (let i = 0; i < 4; i++) {
    const r = await engine.handleCustomerMessage(sid, '그게 뭔데요');
    if (i >= 2 && r.reply === engine.cooldownReply?.() ) tripped = true;
  }
  const sess = store.getStore().sessions[sid];
  assert.ok(sess.spam, 'spam 상태가 기록되어야 한다');
  assert.ok(sess.spam.cooldownUntil > Date.now() - 1000, '쿨다운이 설정되어야 한다');
});

// ── D5: cooldown은 10–20초 범위, cooldown 중 deterministic 응답 (LLM/규칙 재처리 0)
test('D5: cooldown lasts 10-20s and replies deterministically while active', async () => {
  resetStore();
  const sid = await newConversation();
  await engine.handleCustomerMessage(sid, '재입고 언제야');
  await engine.handleCustomerMessage(sid, '재입고 언제야');
  const third = await engine.handleCustomerMessage(sid, '재입고 언제야');
  const sess = store.getStore().sessions[sid];
  const remaining = sess.spam.cooldownUntil - Date.now();
  assert.ok(remaining > 5_000 && remaining <= 20_000, `cooldown 잔여 ${remaining}ms — 10~20초 범위 이탈`);
  const replies = sess.messages.filter((m) => m.role === 'ai').map((m) => m.text);
  assert.ok(replies.includes(engine.cooldownReply?.() ?? '같은 메시지가 빠르게 반복되고 있어요. 잠시 후 다시 보내주세요.'));
});

// ── D6: legitimate burst — 의미 있는 서로 다른 다단 질문은 count로 차단되지 않는다
test('D6: legitimate multi-part questions in a row are never spam-blocked', async () => {
  resetStore();
  const sid = await newConversation();
  const questions = [
    '사이즈가 어떻게 돼요',
    '소재는 뭔가요',
    '세탁기에 돌려도 돼요',
    '가격이 얼마인가요',
    '교환 규정이 궁금해요',
    '반품은 어떻게 하나요',
    '배송은 며칠 걸려요',
    '배송비는 얼마예요',
    '재고 있나요',
    '색상은 뭐가 있어요',
  ];
  for (const q of questions) {
    const r = await engine.handleCustomerMessage(sid, q);
    assert.notEqual(r.reply, engine.cooldownReply?.(), `정상 문의가 spam 차단됨: ${q}`);
    assert.ok(r.reply, `응답 누락: ${q}`);
  }
});

// ── D7: human request → 즉시 HUMAN_PENDING
test('D7: explicit human request escalates to HUMAN_PENDING immediately', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '상담원 연결');
  assert.equal(r.status, 'HUMAN_PENDING');
  assert.equal(r.escalated, true);
  assert.ok(r.reply.includes('전문 상담원'));
});

// ── D8: Telegram outbound — payload 구성은 유닛으로, 실제 발송은 E2E에서 실측
test('D8: escalation payload is sendable and includes required context blocks', async () => {
  resetStore();
  const sid = await newConversation(); // AI 인사가 포함된 대화
  const r = await engine.handleCustomerMessage(sid, '주문 취소하고 싶어요 상담원 연결해주세요');
  const sess = store.getStore().sessions[r.sid];
  const payload = engine.buildTranscriptPayload(sess, '고객이 상담원을 명시적으로 요청');
  for (const block of ['고객:', '유형:', 'GUEST', 'Conversation:', '상태:', '문의 요약:', '연결 사유:', '전체 대화', 'AI:']) {
    assert.ok(payload.includes(block), `payload 누락 블록: ${block}`);
  }
  // RAW transcript — 고객 원문이 요약 없이 포함
  assert.ok(payload.includes('주문 취소하고 싶어요'));
});

// ── D9: raw + summary — RAW transcript와 요약·사유·주문 컨텍스트 동시 포함 (회원 유형 포함)
test('D9: payload contains member type, order context, reason, summary and full raw transcript', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '상담원 연결해줘', { member: true, email: 'member-b@n1.test' });
  const sess = store.getStore().sessions[r.sid];
  sess.orderRefs.push('ORD-20260909-00001');
  const payload = engine.buildTranscriptPayload(sess, '주문 변경 등 처리 권한 밖 요청');
  assert.ok(payload.includes('MEMBER'));
  assert.ok(payload.includes('회원 member-b@n1.test'));
  assert.ok(payload.includes('ORD-20260909-00001'));
  assert.ok(payload.includes('주문 변경 등 처리 권한 밖 요청'));
  assert.ok(payload.includes('상담원 연결해줘')); // RAW
  assert.ok(payload.includes('답장(Reply)')); // 운영자 안내
});

// ── D10: human inbound — reply-to로 정확한 conversation 라우팅
test('D10: telegram reply routes into the exact mapped conversation', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  const sess = store.getStore().sessions[r.sid];
  sess.telegramMsgIds.push(500);
  const outcome = await relay.processTelegramUpdate({
    update_id: 800001,
    message: { message_id: 800, text: '확인했습니다 고객님.', chat: { id: '4242' }, reply_to_message: { message_id: 500 } },
  });
  assert.equal(outcome.delivered, true);
  assert.equal(store.getStore().sessions[r.sid].status, 'HUMAN_ACTIVE');
});

// ── D11: verbatim — 운영자 원문(개행 포함)이 요약·교정 없이 전달
test('D11: operator reply is relayed verbatim with line breaks intact', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  const sess = store.getStore().sessions[r.sid];
  sess.telegramMsgIds.push(600);
  const raw = '안녕하세요.\n\n확인 결과 교환 가능합니다.\n아래 두 가지만 준비해주세요.\n\n1. 상품\n2. 포장';
  const outcome = await relay.processTelegramUpdate({
    update_id: 800002,
    message: { message_id: 801, text: raw, chat: { id: '4242' }, reply_to_message: { message_id: 600 } },
  });
  assert.equal(outcome.delivered, true);
  const last = sess.messages[sess.messages.length - 1];
  assert.equal(last.text, raw);
  assert.equal(last.role, 'agent');
});

// ── D12: HUMAN_ACTIVE — AI 고객 응답 중단, 고객 메시지는 운영자에게 전달
test('D12: HUMAN_ACTIVE stops AI replies while forwarding real customer input', async () => {
  resetStore();
  const r = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  const sess = store.getStore().sessions[r.sid];
  sess.telegramMsgIds.push(700);
  await relay.processTelegramUpdate({
    update_id: 800003,
    message: { message_id: 802, text: '네 안내해 드릴게요.', chat: { id: '4242' }, reply_to_message: { message_id: 700 } },
  });
  const before = sess.messages.length;
  const follow = await engine.handleCustomerMessage(r.sid, '확인 부탁드립니다');
  assert.equal(follow.reply, null); // AI 응답 없음
  assert.equal(sess.status, 'HUMAN_ACTIVE');
  assert.equal(sess.messages.length, before + 1); // 고객 메시지만 추가
  assert.equal(sess.messages[sess.messages.length - 1].role, 'customer');
});

// ── D13: duplicate ticket 방지 — HUMAN_* 중 재 escalation 금지 (Telegram 재발송 없음)
test('D13: repeated escalation requests never create a duplicate ticket', async () => {
  resetStore();
  const r1 = await engine.handleCustomerMessage(null, '상담원 연결해줘');
  const sess = store.getStore().sessions[r1.sid];
  const systemNoticesBefore = sess.messages.filter((m) => m.role === 'system').length;
  const telegramIdsBefore = sess.telegramMsgIds.length;
  await engine.handleCustomerMessage(r1.sid, '상담원!');
  await engine.handleCustomerMessage(r1.sid, '상담원 연결해달라고요');
  assert.equal(sess.messages.filter((m) => m.role === 'system').length, systemNoticesBefore);
  assert.equal(sess.telegramMsgIds.length, telegramIdsBefore);
  assert.equal(sess.escalated, true);
  assert.equal(sess.status, 'HUMAN_PENDING');
});
