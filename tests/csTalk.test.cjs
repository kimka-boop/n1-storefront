/**
 * N°1 CS — 소톡/매크로 반복/spam gate 테스트 (통합 미션 §67·§68)
 * 규칙 기반 엔진만 검증 — LLM 호출 없음(비용 0).
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

const engine = require('../lib/csEngine.ts');
const cs = require('../lib/cs.ts');
const store = require('../lib/csStore.ts');

process.env.N1_CS_BOT_TOKEN = '';
process.env.N1_CS_CHAT_ID = '';

let seq = 0;
function sid() { return `#SESS_TALK_${++seq}`; }

/** 세션을 초기화하고 메시지를 순서대로 보낸 뒤 AI 응답 배열 반환 */
async function converse(sid_, texts) {
  const replies = [];
  for (const t of texts) {
    const r = await engine.handleCustomerMessage(sid_, t);
    replies.push(r.reply);
  }
  return replies;
}

test('CS1/CS2 — 첫 인사 scripted 1회, 두 번째 인사는 contextual(동일 문구 아님)', async () => {
  const s = sid();
  const [a, b] = await converse(s, ['안녕하세요', '안녕하세요']);
  assert.equal(a, cs.AI_GREETING);
  assert.notEqual(b, a);
});

test('CS3 — 날씨 잡담: 고정 macro 대신 소톡 응답', async () => {
  const s = sid();
  await converse(s, ['안녕하세요']);
  const [r] = await converse(s, ['날씨가 참 좋아요.']);
  assert.ok(!r.includes('주문번호'), 'macro fallback이 나오면 실패');
  assert.ok(r.length > 0 && r.length < 120, '짧고 자연스러운 응답');
});

test('CS4 — 유사 잡담 반복: 동일 문구 연속 방지', async () => {
  const s = sid();
  await converse(s, ['날씨가 좋아요.', '날씨가 좋다고요.']);
  const sess = store.getStore().sessions[s];
  const aiMsgs = sess.messages.filter(m => m.role === 'ai').map(m => m.text);
  const lastTwo = aiMsgs.slice(-2);
  assert.notEqual(lastTwo[0], lastTwo[1], '같은 문구 연속 금지');
});

test('CS5 — 고양이 잡담: 짧은 acknowledgement', async () => {
  const s = sid();
  await converse(s, ['안녕하세요']);
  const [r] = await converse(s, ['고양이는 귀여워.']);
  assert.ok(r.includes('반려동물') || r.includes('귀엽') || r.length < 100);
});

test('CS6 — 무해한 nonsense: macro 반복 금지', async () => {
  const s = sid();
  await converse(s, ['안녕하세요', 'ㅁㄴㅇㄹ']);
  const sess = store.getStore().sessions[s];
  const last = sess.messages.filter(m => m.role === 'ai').pop();
  assert.ok(!last.text.includes('주문번호나 상품명을 함께 알려주시면 더 정확히'), '구 macro fallback 금지');
});

test('SP1/SP2 — 동일 메시지 4회 반복: 쿨다운 deterministic 응답 진입', async () => {
  const s = sid();
  await converse(s, ['안녕하세요']);
  const replies = await converse(s, ['배송 언제 와요', '배송 언제 와요', '배송 언제 와요', '배송 언제 와요']);
  // 3회째(동일 지문 3번째)부터 쿨다운 진입 — 마지막은 deterministic 문구
  assert.ok(replies.some(r => r.includes('같은 메시지가 빠르게 반복되고 있어요')), '쿨다운 문구 진입');
});

test('SP3 — 의미 있게 다른 긴급 문의 연속 전송: 차단되지 않음', async () => {
  const s = sid();
  await converse(s, ['안녕하세요']);
  const texts = ['배송이 안 와요', '주문번호는 55555', '어제 주문했어요', '언제 도착하나요', '확인 부탁드려요'];
  const replies = await converse(s, texts);
  const blocked = replies.filter(r => r && r.includes('같은 메시지가 빠르게 반복되고 있어요'));
  assert.equal(blocked.length, 0, '정상 긴급 문의는 차단 금지');
});

test('SP4 — 쿨다운 경과 후 정상 응답 복귀', async () => {
  const s = sid();
  await converse(s, ['안녕하세요']);
  await converse(s, ['좋아요', '좋아요', '좋아요']); // 쿨다운 진입
  const sess = store.getStore().sessions[s];
  sess.spam.cooldownUntil = Date.now() - 1; // 시간 경과 시뮬레이션
  const [r] = await converse(s, ['주문 관련해서 질문 있어요']);
  assert.ok(!r.includes('같은 메시지가 빠르게 반복되고 있어요'), '쿨다운 해제 후 정상 응답');
});
