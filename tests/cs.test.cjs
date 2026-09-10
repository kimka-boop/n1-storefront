const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → worktree lib/*.ts
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

// 테스트 환경: 텔레그램 토큰 없음 → 전송 실패가 정상 경로 (거짓 성공 없음)
// 채널 id는 authorization 검증용으로만 설정 (값은 임의의 테스트 상수)
process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '4242';

function freshSession(sid = '#SESS_TEST_1') {
  delete store.getStore().sessions[sid];
  return store.ensureSession(store.getStore(), sid);
}

// ── CASE 1: 첫 인사 → scripted welcome 1회
test('first greeting-only message returns the scripted welcome once', async () => {
  const r = await engine.handleCustomerMessage(null, '안녕하세요');
  assert.equal(r.reply, cs.AI_GREETING);
  assert.equal(r.status, 'GREETED');
  assert.ok(!cs.AI_GREETING.includes('1. 주문')); // 번호 메뉴 금지 (미션 §43)
});

// ── CASE 2: 다시 인사 → 반복 스크립트 금지, 문맥 응답
test('second greeting is contextual, not the repeated script', async () => {
  const sid = '#SESS_TEST_2';
  await engine.handleCustomerMessage(sid, '안녕하세요');
  const r = await engine.handleCustomerMessage(sid, '안녕하세요');
  assert.notEqual(r.reply, cs.AI_GREETING);
  assert.equal(r.reply, cs.SECOND_GREETING);
});

// ── CASE 3: 첫 메시지에 주문번호 → 바로 주문 조회 (오프라인: 조회 실패 → 정직한 상담원 전달)
test('first message containing an order number goes straight to lookup', async () => {
  const r = await engine.handleCustomerMessage(null, '주문번호 12345 배송 언제 와요?');
  // Sheets 접근 불가 환경 → "없다고 단정"하지 않고 상담원 확인 경로 (미션 §46)
  assert.equal(r.escalated, true);
  assert.equal(r.reply, cs.LOOKUP_FAILURE_NOTICE);
});

// ── 주문번호 인식 정확도
test('order number extraction: formal, near-keyword, trailing, and no false positives', () => {
  assert.equal(cs.extractOrderNumber('ORD-20260909-12345 주문 조회'), 'ORD-20260909-12345');
  assert.equal(cs.extractOrderNumber('주문번호 12345인데요'), '12345');
  assert.equal(cs.extractOrderNumber('12345 주문 배송 언제 와요?'), '12345');
  assert.equal(cs.extractOrderNumber('안녕하세요'), null);
  assert.equal(cs.extractOrderNumber('010-1234-5678로 연락주세요'), null);
  assert.equal(cs.extractOrderNumber('3만원짜리 세탁 어떻게 해요?'), null);
});

// ── CASE 10: 상담원 명시 요청 → 즉시 escalation
test('explicit human request escalates immediately', async () => {
  const r = await engine.handleCustomerMessage(null, '상담원이랑 얘기할래요');
  assert.equal(r.escalated, true);
  assert.equal(r.status, 'HUMAN_PENDING');
  assert.ok(r.reply.includes('전문 상담원'));
});

// ── CASE 11: 권한 경계 — 주문 컨텍스트의 쓰기 요청은 escalation
test('write ops with order context escalate; policy questions do not', async () => {
  const withCtx = cs.classifyEscalation('이 주문 취소하고 싶어요', true);
  assert.equal(withCtx.escalate, true);
  const policyOnly = cs.classifyEscalation('반품 정책이 어떻게 되나요?', false);
  assert.equal(policyOnly.escalate, false); // 정책 설명은 AI 범위 (미션 §22.G)
  assert.equal(cs.classifyEscalation('쿠폰 좀 주세요', false).escalate, true);
  assert.equal(cs.classifyEscalation('상품 불량인 것 같아요', true).escalate, true);
  assert.equal(cs.classifyEscalation('비밀번호를 바꾸고 싶어요', false).escalate, true);
});

// ── CASE 14/45: HUMAN_ACTIVE에서 AI 끼어듦 금지 + escalation 중복 생성 금지
test('human takeover: AI stays silent and escalation is not duplicated', async () => {
  const sid = '#SESS_TEST_3';
  await engine.handleCustomerMessage(sid, '상담원 연결해줘'); // → HUMAN_PENDING
  const again = await engine.handleCustomerMessage(sid, '상담원!'); // 이미 대기 중
  assert.equal(again.reply, null); // 새 escalation 문구도 재생성 안 함 (미션 §45)
  const during = await engine.handleCustomerMessage(sid, '추가 문의 드려요');
  assert.equal(during.reply, null); // AI 끼어들기 금지 (미션 §29)
  const sess = store.getStore().sessions[sid];
  assert.equal(sess.messages.filter((m) => m.role === 'system').length, 1); // 안내 1회
  // ── 운영자 답장 → VERBATIM 전달 (미션 §27, reply-to 단일 라우팅 §9)
  // 토큰 없는 테스트 환경에서는 escalation 원문이 실제 전송되지 않으므로,
  // 전송 성공 시 기록될 앵커 message_id를 수동으로 시뮬레이션한다.
  sess.telegramMsgIds.push(781);
  const relayed = await relay.processTelegramUpdate({
    update_id: 555001,
    message: {
      message_id: 1001,
      text: '안내 말씀 드립니다. 원문 그대로 전달됩니다 [테스트]',
      chat: { id: '4242' },
      reply_to_message: { message_id: 781 },
    },
  });
  assert.equal(relayed.delivered, true); // reply-to 매핑으로만 전달된다
  const last = sess.messages[sess.messages.length - 1];
  assert.equal(last.role, 'agent');
  assert.equal(last.text, '안내 말씀 드립니다. 원문 그대로 전달됩니다 [테스트]'); // 요약/교정 없음
  assert.equal(sess.status, 'HUMAN_ACTIVE');
});

// ── CASE 15: 환불 의지 — 워크플로 시작이 우선 (미션 §34·§36, 구계약 '무조건 에스컬레이션' 대체)
//   게스트에게는 본인확인 경로만 안내된다 — 임의 주문 열람 없음, 거짓 성공 없음.
test('refund intent starts the workflow honestly (guest ownership guidance, no fake escalation)', async () => {
  freshSession('#SESS_TEST_4');
  const r = await engine.handleCustomerMessage('#SESS_TEST_4', '환불해주세요');
  assert.equal(r.escalated, false);
  assert.ok(r.reply.includes('본인 확인') || r.reply.includes('주문번호')); // 게스트 본인확인 안내 (§36)
  // 명시적 상담원 요청은 여전히 에스컬레이션 — 토큰 미설정이면 성공 위장 없음(콘솔 경고만)
  const r2 = await engine.handleCustomerMessage('#SESS_TEST_4', '전문 상담원 연결해주세요');
  assert.equal(r2.escalated, true);
});

// ── CASE 16: 프라이버시 — 주문 요약은 비민감 필드만, 본인확인은 뒷자리
test('privacy: safe order view has no PII, phone verification uses last4', () => {
  const view = cs.toSafeOrderView({
    orderId: 'ORD-20260909-00001',
    orderTime: '2026-09-09T01:00:00Z',
    itemsJson: JSON.stringify([{ name: '세미 오버핏 폴리 셔츠', color: '아이보리', size: 'M', qty: 1 }]),
    shipStatus: '접수', paymentStatus: '입금대기', carrier: '', trackingNo: '', total: 39800,
  });
  assert.ok(view);
  assert.equal(view.itemLine, '세미 오버핏 폴리 셔츠 / 아이보리 / M ×1');
  const summary = cs.formatOrderSummary(view);
  assert.ok(summary.includes('ORD-20260909-00001'));
  assert.ok(!summary.includes('010')); // 전화번호 노출 없음
  assert.ok(cs.verifyByPhoneLast4('010-1234-5678', '5678'));
  assert.ok(!cs.verifyByPhoneLast4('010-1234-5678', '1234'));
  assert.equal(cs.maskPhone('010-1234-5678'), '010-****-5678');
  // 항목 JSON이 깨진 주문은 요약 자체를 만들지 않는다 (창작 금지)
  assert.equal(cs.toSafeOrderView({ orderId: 'X', orderTime: '', itemsJson: 'BROKEN', shipStatus: '', paymentStatus: '', carrier: '', trackingNo: '', total: 0 }), null);
});

// ── 게스트 식별 (미션 §35): 운영자 컨텍스트 전용 라벨, 고객 UI 비노출 값
test('guest sessions get stable operator-only labels', () => {
  const s = freshSession('#SESS_TEST_5');
  assert.ok(s.customer.label.startsWith('비회원'));
  assert.equal(s.customer.type, 'GUEST');
  const s2 = store.ensureSession(store.getStore(), '#SESS_TEST_5'); // 동일 sid 재조회 — 라벨 고정
  assert.equal(s2.customer.label, s.customer.label);
});

// ── 인사 경계값
test('greeting detection boundaries', () => {
  assert.equal(cs.isGreetingOnly('안녕하세요'), true);
  assert.equal(cs.isGreetingOnly(' 안녕하세요! '), true);
  assert.equal(cs.isGreetingOnly('안녕하세요 주문 문의요'), false);
  assert.equal(cs.isGreetingOnly('안녕하세요 저 이번에 주문했는데요 배송이'), false);
});

// ── CASE 12: Telegram 페이로드에 raw transcript + summary + customer + reason 포함
test('escalation transcript payload contains raw transcript and metadata', async () => {
  const sid = '#SESS_TEST_6';
  await engine.handleCustomerMessage(sid, '안녕하세요');
  await engine.handleCustomerMessage(sid, '배송이 너무 느려요 상담원 연결해 주세요');
  const sess = store.getStore().sessions[sid];
  // engine이 비공개 함수로 전송하므로 페이로드 빌더는 내보내지 않는다 — 전사본 구성으로 검증
  const customers = sess.messages.filter((m) => m.role === 'customer');
  const systems = sess.messages.filter((m) => m.role === 'system');
  assert.equal(customers.length, 2); // 원문 전체 보존
  assert.equal(systems.length, 1);
  assert.ok(systems[0].text.includes('전문 상담원'));
  assert.equal(sess.escalated, true);
});
