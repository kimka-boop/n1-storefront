const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → lib/*.ts (transpile require 체인 — commerce.test.cjs 와 동일 harness)
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

const paymentState = require('../lib/paymentState.ts');
const paymentProvider = require('../lib/paymentProvider.ts');
const payments = require('../lib/payments.ts');
const paymentFlow = require('../lib/paymentFlow.ts');
const orderLock = require('../lib/orderLock.ts');
const hermesEvents = require('../lib/hermesEvents.ts');
const idem = require('../lib/idempotency.ts');
const errorSanitize = require('../lib/errorSanitize.ts');

function resetAll() {
  idem.resetIdempotency();
  orderLock.resetOrderLock();
  paymentProvider.resetTestPg();
}

// ═══════════ P1 — Payment State Machine (주문과 별개) ═══════════

test('P1 결제 상태 전이표: CREATED→PENDING→CONFIRMED 합법, CONFIRMED→PAID류 불법, 실패는 종단', () => {
  assert.ok(paymentState.paymentCanTransition('CREATED', 'PENDING'));
  assert.ok(paymentState.paymentCanTransition('PENDING', 'CONFIRMED'));
  assert.ok(paymentState.paymentCanTransition('PENDING', 'AUTHORIZED'));
  assert.ok(paymentState.paymentCanTransition('CONFIRMED', 'REFUND_PENDING'));
  assert.ok(paymentState.paymentCanTransition('REFUND_PENDING', 'REFUNDED'));
  // 주문 상태(lib/orderState)와 결제 상태는 다른 언어다 — 혼용 차단
  assert.equal(paymentState.paymentCanTransition('PENDING', 'PAID'), false);
  assert.equal(paymentState.paymentCanTransition('CONFIRMED', 'PENDING'), false);
  assert.equal(paymentState.paymentCanTransition('FAILED', 'PENDING'), false); // 재시도 = 새 레코드
  assert.ok(paymentState.paymentIsTerminal('FAILED'));
  assert.ok(paymentState.paymentIsTerminal('REFUNDED'));
  assert.ok(!paymentState.paymentIsTerminal('CONFIRMED'));
  assert.throws(() => paymentState.assertPaymentTransition('CONFIRMED', 'PENDING'));
});

test('P2 레거시 결제상태 매핑: Orders.결제상태 한글 → 결제 상태 (무통장 V1 읽기 계약)', () => {
  assert.equal(paymentState.derivePaymentState('입금대기'), 'PENDING');
  assert.equal(paymentState.derivePaymentState('입금확인중'), 'PENDING');
  assert.equal(paymentState.derivePaymentState('결제대기'), 'PENDING');
  assert.equal(paymentState.derivePaymentState(''), 'PENDING'); // 빈값 = 아직 결제 안 됨
  assert.equal(paymentState.derivePaymentState('결제완료'), 'CONFIRMED');
  assert.equal(paymentState.derivePaymentState('결제취소'), 'CANCELLED');
  assert.equal(paymentState.derivePaymentState('결제실패'), 'FAILED');
  assert.equal(paymentState.derivePaymentState('환불완료'), 'REFUNDED');
  assert.equal(paymentState.derivePaymentState('환불'), 'REFUND_PENDING');
});

// ═══════════ P3 — NO_LIVE_PG 어댑터 + resolver (미션 §17) ═══════════

test('P3 no_live_pg: 모든 호출이 PAYMENT_PROVIDER_NOT_CONFIGURED — 위장 성공 0', async () => {
  const p = paymentProvider.noLivePgProvider;
  assert.equal(p.name, 'no_live_pg');
  assert.equal(p.live, false);

  const req = await p.createPaymentRequest({ order_id: 'ORD-X', amount: 10000, currency: 'KRW', order_name: 't' });
  assert.equal(req.ok, false);
  assert.equal(req.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(req.customer_message, '결제 시스템 준비 중입니다.');
  assert.equal(req.checkout_url, undefined); // 결제창 위장 없음

  const v = await p.verifyPayment({ payment_id: 'P1', provider_payment_id: 'pp1', order_id: 'ORD-X' });
  assert.equal(v.ok, false);
  assert.equal(v.status, 'FAILED');

  assert.equal(p.verifyWebhookSignature({}, '{}'), false); // webhook 수용 없음
});

test('P3 resolver: env 미설정 → no_live_pg / test+플래그 → test_only / 알수없는 PG명 → no_live_pg 폴백', () => {
  const unset = paymentProvider.resolvePaymentProvider({});
  assert.equal(unset.provider.name, 'no_live_pg');
  assert.equal(unset.livePgAvailable, false);

  const testOff = paymentProvider.resolvePaymentProvider({ N1_PG_PROVIDER: 'test', N1_PG_TEST_ONLY: 'false' });
  assert.equal(testOff.provider.name, 'no_live_pg'); // 플래그 없으면 test provider도 없다

  const testOn = paymentProvider.resolvePaymentProvider({ N1_PG_PROVIDER: 'test', N1_PG_TEST_ONLY: 'true' });
  assert.equal(testOn.provider.name, 'test_only');
  assert.equal(testOn.livePgAvailable, true);

  const realPg = paymentProvider.resolvePaymentProvider({ N1_PG_PROVIDER: 'toss' });
  assert.equal(realPg.provider.name, 'no_live_pg'); // 어댑터 미구현 — 연결됐다고 말하지 않는다
  assert.equal(realPg.livePgAvailable, false);
});

// ═══════════ P4 — 결제수단 결정 (서버 권위) ═══════════

test('P4 resolveServerPaymentMethod: 미지정=무통장, pg_card는 live PG에서만, 지원외 거절', () => {
  assert.deepEqual(payments.resolveServerPaymentMethod(undefined, false), { ok: true, method: 'bank_transfer' });
  assert.deepEqual(payments.resolveServerPaymentMethod('bank_transfer', false), { ok: true, method: 'bank_transfer' });

  const refused = payments.resolveServerPaymentMethod('pg_card', false);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(refused.customer_message, '결제 시스템 준비 중입니다.');

  assert.deepEqual(payments.resolveServerPaymentMethod('pg_card', true), { ok: true, method: 'pg_card' });

  const bad = payments.resolveServerPaymentMethod('crypto', true);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'PAYMENT_METHOD_UNSUPPORTED');
});

// ═══════════ P5 — TEST_ONLY 합성 PG (프로덕션 주문 격리) ═══════════

test('P5 test_only: TEST- 주문만 수용, 명시 정산 전까지 verify는 PENDING, 정산 후 CONFIRMED', async () => {
  resetAll();
  const p = paymentProvider.testOnlyProvider;

  // 프로덕션 주문번호 거절 — 격리 계약
  const prod = await p.createPaymentRequest({ order_id: 'ORD-20260910-12345', amount: 1000, currency: 'KRW', order_name: 't' });
  assert.equal(prod.ok, false);
  assert.equal(prod.code, 'PAYMENT_PROVIDER_TEST_ORDER_FORBIDDEN');

  const req = await p.createPaymentRequest({ order_id: 'TEST-20260910-00001', amount: 39800, currency: 'KRW', order_name: 't' });
  assert.equal(req.ok, true);
  assert.ok(req.provider_payment_id.startsWith('testpay_'));

  // 정산 전 — PG 입장에서 아직 승인 아님 (가장 정직한 상태)
  const before = await p.verifyPayment({ payment_id: 'P', provider_payment_id: req.provider_payment_id, order_id: 'TEST-20260910-00001' });
  assert.equal(before.ok, false);
  assert.equal(before.status, 'PENDING');

  // 명시 정산 발화 → 검증 CONFIRMED (금액 응답)
  assert.equal(paymentProvider.settleTestPayment(req.provider_payment_id), true);
  const after = await p.verifyPayment({ payment_id: 'P', provider_payment_id: req.provider_payment_id, order_id: 'TEST-20260910-00001' });
  assert.equal(after.ok, true);
  assert.equal(after.status, 'CONFIRMED');
  assert.equal(after.amount, 39800);

  // 이중 정산 불가
  assert.equal(paymentProvider.settleTestPayment(req.provider_payment_id), false);
});

// ═══════════ P6 — createPaymentRequestForOrder (미션 §18) ═══════════

function makeDeps(over = {}) {
  const orders = new Map();
  const paymentRows = [];
  const events = [];
  let providerCalls = 0;
  let telegramCalls = 0;
  let decrementCalls = 0;

  const order = (over.orderId || 'TEST-20260910-00001');
  orders.set(order, {
    orderId: order,
    orderTime: '2026-09-10T00:00:00Z',
    paymentMethod: 'pg_card',
    paymentStatus: '결제대기',
    depositor: '홍길동',
    customerName: '홍길동',
    customerPhone: '010-1111-2222',
    customerAddress: '(06236) 서울 강남구 어딘가 12',
    customerId: 'C-1',
    itemsJson: JSON.stringify([{ sku: 'PRD-X', name: '니트', color: '아이보리', size: 'M', qty: 1, unit_price: 39800 }]),
    total: 42800, // 39800 + 배송비 3000 (서버가 계산한 최종 결제대금)
    shipType: '단일배송',
    shipStatus: '접수',
    carrier: '', trackingNo: '', csMemo: '',
    raw: { '고객이메일': '' },
  });

  const deps = {
    provider: over.provider || paymentProvider.testOnlyProvider,
    loadOrder: async (id) => orders.get(id) || null,
    loadPrice: async (sku) => (over.priceMap && over.priceMap[sku] !== undefined) ? { price: over.priceMap[sku], name: '니트' } : { price: 39800, name: '니트' },
    createPayment: async (input) => {
      const record = {
        confirmedAmount: null, confirmedAt: '', failedAt: '', cancelledAt: '',
        failureCode: '', failureMessage: '', ...input,
      };
      paymentRows.push(record);
      return { ok: true, record };
    },
    findPaymentsByOrder: async (id) => paymentRows.filter((r) => r.orderId === id),
    findPaymentByProviderPaymentId: async (ppid) => paymentRows.find((r) => r.providerPaymentId === ppid) || null,
    updatePayment: async (paymentId, patch) => {
      const r = paymentRows.find((x) => x.paymentId === paymentId);
      if (!r) return { ok: false };
      Object.assign(r, patch);
      return { ok: true };
    },
    confirmOrderPaid: async (id, info) => {
      const o = orders.get(id);
      if (!o) return { transitioned: false, alreadyPaid: false };
      if (o.paymentStatus.includes('완료')) return { transitioned: false, alreadyPaid: true };
      o.paymentStatus = '결제완료';
      o.raw['PG거래ID'] = info.providerPaymentId;
      return { transitioned: true, alreadyPaid: false };
    },
    decrementStock: async () => { decrementCalls += 1; },
    emitEvent: async (e) => { events.push(e.eventType); return true; },
    notifyPaymentConfirmed: async () => { telegramCalls += 1; },
    now: () => new Date('2026-09-10T12:00:00Z'),
  };
  return { deps, orders, paymentRows, events, counters: { get providerCalls() { return providerCalls; }, get telegramCalls() { return telegramCalls; }, get decrementCalls() { return decrementCalls; } } };
}

test('P6 결제 요청 계약: 없는 주문 404 / 무통장 주문 400 / 금액 불일치 409', async () => {
  resetAll();
  const ctx = makeDeps();

  const missing = await paymentFlow.createPaymentRequestForOrder(ctx.deps, 'TEST-20260910-99999');
  assert.equal(missing.http, 404);

  const bank = makeDeps();
  bank.orders.get('TEST-20260910-00001').paymentMethod = 'bank_transfer';
  const na = await paymentFlow.createPaymentRequestForOrder(bank.deps, 'TEST-20260910-00001');
  assert.equal(na.http, 400);
  assert.equal(na.payload.code, 'PAYMENT_REQUEST_NOT_APPLICABLE');

  // 시트 판매가가 변경되어 재계산 금액이 주문 저장 금액과 다르면 절대 결제창을 열지 않는다
  const changed = makeDeps({ priceMap: { 'PRD-X': 50000 } });
  const mm = await paymentFlow.createPaymentRequestForOrder(changed.deps, 'TEST-20260910-00001');
  assert.equal(mm.http, 409);
  assert.equal(mm.payload.code, 'AMOUNT_MISMATCH');
});

test('P6 결제 요청 정상 경로: 레코드 CREATED→PENDING, 최종 결제대금(배송비 포함)으로 PG 호출, 이벤트 발행', async () => {
  resetAll();
  const ctx = makeDeps();
  const result = await paymentFlow.createPaymentRequestForOrder(ctx.deps, 'TEST-20260910-00001');
  assert.equal(result.ok, true);
  assert.equal(result.payload.amount, 42800); // 39800 + 배송비 3000 — 서버가 최종 계산
  assert.equal(result.payload.status, 'PENDING');
  assert.ok(String(result.payload.checkout_url).includes('pid='));

  const rec = ctx.paymentRows[0];
  assert.equal(rec.status, 'PENDING');
  assert.equal(rec.requestedAmount, 42800);
  assert.equal(rec.testFlag, 'TEST_ONLY');
  assert.deepEqual(ctx.events, ['PAYMENT_REQUESTED']);

  // 재호출 — 열려 있는 시도 재사용 (중복 시도 생성 없음)
  const again = await paymentFlow.createPaymentRequestForOrder(ctx.deps, 'TEST-20260910-00001');
  assert.equal(again.payload.duplicate, true);
  assert.equal(ctx.paymentRows.length, 1);
});

test('P6 PG 미연결 환경에서의 어댑터 호출: 레코드 FAILED + 요청 실패 이벤트 + 503 정직 응답', async () => {
  resetAll();
  const ctx = makeDeps({ provider: paymentProvider.noLivePgProvider });
  const result = await paymentFlow.createPaymentRequestForOrder(ctx.deps, 'TEST-20260910-00001');
  assert.equal(result.ok, false);
  assert.equal(result.http, 503);
  assert.equal(result.payload.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(result.payload.customer_message, '결제 시스템 준비 중입니다.');
  const rec = ctx.paymentRows[0];
  assert.equal(rec.status, 'FAILED');
  assert.deepEqual(ctx.events, ['PAYMENT_REQUEST_FAILED']);
});

// ═══════════ P7 — webhook 검증 → 주문 확정 (미션 §19~§22) ═══════════

async function setupSettled(deps, ctx, orderId = 'TEST-20260910-00001') {
  const created = await paymentFlow.createPaymentRequestForOrder(deps, orderId);
  const ppid = created.payload.checkout_url.match(/pid=([^&]+)/)[1];
  assert.equal(paymentProvider.settleTestPayment(ppid), true);
  return ppid;
}

test('P7 webhook: 정산된 거래 → 서버 검증 CONFIRMED → 주문 결제완료 + 지연 차감 1회 + 이벤트·알림', async () => {
  resetAll();
  const ctx = makeDeps();
  const ppid = await setupSettled(ctx.deps, ctx);

  const result = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: { 'content-type': 'application/json' },
    rawBody: JSON.stringify({ provider_payment_id: ppid }),
    parsed: { provider_payment_id: ppid },
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.status, 'CONFIRMED');
  assert.equal(ctx.orders.get('TEST-20260910-00001').paymentStatus, '결제완료');
  assert.equal(ctx.counters.decrementCalls, 1); // PG 주문의 지연 차감 — 여기서 1회
  assert.ok(ctx.events.includes('PAYMENT_CONFIRMED'));
  assert.equal(ctx.counters.telegramCalls, 1);

  // 같은 webhook 재도착 — 중복 확정 없이 duplicate (차감 재호출 없음)
  const again = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: {}, rawBody: JSON.stringify({ provider_payment_id: ppid }),
    parsed: { provider_payment_id: ppid },
  });
  assert.equal(again.payload.duplicate, true);
  assert.equal(ctx.counters.decrementCalls, 1);
});

test('P7 webhook: 미정산(PENDING) 검증 → 주문 유지, 가짜 성공 없음 / 금액 불일치 → 확정 거절', async () => {
  resetAll();
  const ctx = makeDeps();
  const created = await paymentFlow.createPaymentRequestForOrder(ctx.deps, 'TEST-20260910-00001');
  const ppid = created.payload.checkout_url.match(/pid=([^&]+)/)[1];
  // 정산 발화 없이 webhook 도착 — PG 조회가 PENDING을 돌려주면 주문은 그대로다
  const pending = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: {}, rawBody: JSON.stringify({ provider_payment_id: ppid }),
    parsed: { provider_payment_id: ppid },
  });
  assert.equal(pending.payload.status, 'PENDING');
  assert.equal(ctx.orders.get('TEST-20260910-00001').paymentStatus, '결제대기');

  // 정산 금액을 조작해도(주문 금액≠PG 확정 금액) 확정하지 않는다 — 금액 대조 계약
  const tx = global.__n1_test_pg_tx.get(ppid);
  paymentProvider.settleTestPayment(ppid);
  tx.amount = 1; // 1원 결제 위장 시도
  const bad = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: {}, rawBody: JSON.stringify({ provider_payment_id: ppid }),
    parsed: { provider_payment_id: ppid },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.payload.code, 'AMOUNT_MISMATCH');
  assert.equal(ctx.orders.get('TEST-20260910-00001').paymentStatus, '결제대기');
});

test('P7 webhook: 서명 계약 — 수용 불가 webhook은 401로 폐기 (본문 해석 전에 차단)', async () => {
  resetAll();
  // no_live_pg는 서명을 수용하지 않는다 — webhook 처리 자체가 없어야 한다
  const ctx = makeDeps({ provider: paymentProvider.noLivePgProvider });
  const result = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: {}, rawBody: JSON.stringify({ provider_payment_id: 'pp_x' }),
    parsed: { provider_payment_id: 'pp_x' },
  });
  assert.equal(result.http, 401);
  assert.equal(ctx.paymentRows.length, 0); // 서명 불가 webhook은 아무 레코드도 만지지 않는다
});

test('P7 이미 결제완료 처리된 주문(운영자 수동 갱신) — 중복 확정 없이 duplicate', async () => {
  resetAll();
  const ctx = makeDeps();
  const ppid = await setupSettled(ctx.deps, ctx);
  // 운영자가 먼저 시트에서 완료 처리한 상황
  ctx.orders.get('TEST-20260910-00001').paymentStatus = '결제완료';
  const result = await paymentFlow.settlePaymentWebhook(ctx.deps, {
    headers: {}, rawBody: JSON.stringify({ provider_payment_id: ppid }),
    parsed: { provider_payment_id: ppid },
  });
  assert.equal(result.payload.duplicate, true);
  assert.equal(ctx.counters.decrementCalls, 0); // 뒤늦은 webhook이 차감을 또 하지 않는다
});

// ═══════════ P8 — 주문 락 (경합 직렬화, 미션 §10) ═══════════

test('P8 withOrderLock: 동시 임계구역이 겹치지 않고 직렬 실행된다', async () => {
  resetAll();
  const active = [];
  const overlapSeen = [];
  let inFlight = 0;
  const run = (label) => orderLock.withOrderLock(async () => {
    inFlight += 1;
    active.push(label);
    if (inFlight > 1) overlapSeen.push(label);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return label;
  });
  const results = await Promise.all([run('A'), run('B'), run('C')]);
  assert.deepEqual(results.sort(), ['A', 'B', 'C']);
  assert.equal(overlapSeen.length, 0); // 단 하나의 동시 진입도 없다
});

// ═══════════ P9 — HERMES 이벤트 페이로드 (민감 데이터 금지) ═══════════

test('P9 hermes 이벤트 페이로드: 식별자·금액만, PII 필드 없음', () => {
  const payload = hermesEvents.makeHermesEventPayload({
    eventType: 'PAYMENT_CONFIRMED',
    orderId: 'TEST-20260910-00001',
    paymentId: 'PAY-1',
    provider: 'test_only',
    amount: 42800,
  });
  assert.equal(payload.event_type, 'PAYMENT_CONFIRMED');
  assert.ok(payload.event_id.startsWith('EVT-'));
  assert.equal(payload.amount, '42800');
  const text = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['홍길동', '010-', 'address', '전화', '이름']) {
    assert.ok(!text.includes(forbidden), `민감 필드 유출: ${forbidden}`);
  }
});

// ═══════════ P10 — 계약 거절 위생 (L4 소스 잠금과 정합) ═══════════

test('P10 clientSafeRejection: code+status 있는 의도 거절은 그대로, 없는 예외는 기존 치환 계약', () => {
  // 의도적 계약 거절 — 원래 상태·문구·코드 유지
  const coded = errorSanitize.clientSafeRejection(
    Object.assign(new Error('결제 시스템 준비 중입니다.'), { status: 503, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' }),
  );
  assert.equal(coded.status, 503);
  assert.equal(coded.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(coded.message, '결제 시스템 준비 중입니다.');

  // code 없는 5xx — 내부 원문을 고정 문구로 치환 (기존 계약)
  const raw = errorSanitize.clientSafeRejection(new Error('Google Sheets API: quota exceeded secret-path'));
  assert.equal(raw.status, 502);
  assert.equal(raw.code, undefined);
  assert.ok(raw.message.includes('일시적인 접속 문제'));
  assert.ok(!raw.message.includes('Google'));

  // code 없는 4xx — 계약 오류 통과
  const contract = errorSanitize.clientSafeRejection(Object.assign(new Error('필수 항목 누락'), { status: 400 }));
  assert.equal(contract.status, 400);
  assert.equal(contract.message, '필수 항목 누락');
});
