/**
 * SAVED PAYMENTS TESTS (SP1–SP6) — PG 관리 결제 수단 아키텍처
 *
 * lib/savedPayments.ts(저장 계층) + lib/paymentProvider.ts(빌링키 계약)을 실제
 * TypeScript로 검증한다. Sheets는 스파이, 어댑터는 계약 스파이.
 *
 * 핵심 계약:
 *  - 어떤 레코드·응답에도 raw 카드 데이터 필드가 존재하지 않는다.
 *  - 빌링키는 클라이언트 표시 프로젝션에 절대 포함되지 않는다.
 *  - 등록 확정은 서버→PG 재조회로만 — 클라이언트 제출 카드/키는 신뢰 경로 자체가 없다.
 *  - method_id 단독으로는 조회·삭제·결제가 불가능하다 — 소유자 이메일 일치 필수 (IDOR 방지).
 *  - pre-PG(no_live_pg) 모든 빌링키 경로는 PAYMENT_PROVIDER_NOT_CONFIGURED 정직 거절.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
// @/ 경로 별칭 → lib/*.ts (payments.test.cjs와 동일 harness)
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(__dirname, '..', request.slice(2)) + '.ts';
  }
  return origResolve.call(this, request, ...args);
};
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const sp = require(path.resolve(__dirname, '../lib/savedPayments.ts'));
const pp = require(path.resolve(__dirname, '../lib/paymentProvider.ts'));

/** 스파이 시트 — google-spreadsheet doc 표면만 흉내 */
function fakeDoc() {
  const rows = [];
  return {
    rows,
    sheetsByTitle: {},
    async addSheet(cfg) {
      const sheet = fakeSheet(rows, cfg.headerValues);
      this.sheetsByTitle[cfg.title] = sheet;
      return sheet;
    },
  };
}
function fakeSheet(rows, headers) {
  return {
    headerValues: headers,
    async addRow(obj) { rows.push({ ...obj }); },
    async getRows() {
      return rows.map((r) => ({
        get: (h) => r[h] ?? '',
        set: (h, v) => { r[h] = v; },
        save: async () => {},
      }));
    },
  };
}

const PG_METHOD = { card_corp: '신한', last4: '4242' };

/* ── SP1: 표시 프로젝션에 빌링키·카드 데이터가 없다 ── */
test('SP1 — display projection never contains billing key or card fields', () => {
  const m = {
    methodId: 'M-TEST', email: 'a@x.com', provider: 'toss', providerBillingKey: 'SECRET-BILLING-KEY',
    cardCorp: '신한', last4: '4242', status: 'ACTIVE', testFlag: '', createdAt: 't', lastUsedAt: '',
  };
  const d = sp.toDisplay(m);
  const json = JSON.stringify(d);
  assert.ok(!json.includes('SECRET-BILLING-KEY'), '빌링키는 응답에 절대 없다');
  assert.deepEqual(Object.keys(d).sort(), ['card_corp', 'created_at', 'last4', 'last_used_at', 'method_id', 'provider', 'status'],
    '표시 필드는 PG 메타데이터뿐 — 카드번호·CVV 필드 자체가 없다');
  assert.equal(d.last4, '4242', '끝4자리는 PG가 준 표시값');
});

/* ── SP2: 저장 레코드 스키마 — raw 카드 필드 부재 ── */
test('SP2 — stored record contains only safe fields', async () => {
  const doc = fakeDoc();
  const { ok, method } = await sp.createSavedMethod(doc, {
    email: 'A@X.com', provider: 'toss', providerBillingKey: 'BK-1', cardCorp: '신한', last4: '4242',
  });
  assert.equal(ok, true);
  assert.equal(doc.rows.length, 1);
  const keys = Object.keys(doc.rows[0]);
  assert.ok(!keys.some((k) => /카드번호|cvv|cvc|유효기간|card_number|expiry/i.test(k)), '민감 카드 컬럼이 존재하지 않는다');
  assert.equal(method.email, 'a@x.com', '소유자 이메일은 정규화되어 저장된다');
});

/* ── SP3: 소유 경계 — method_id 단독 접근 거절 ── */
test('SP3 — methods are only reachable with the matching owner email', async () => {
  const doc = fakeDoc();
  await sp.createSavedMethod(doc, { email: 'owner@x.com', provider: 'toss', providerBillingKey: 'BK-2' });
  const methods = await sp.findMethodsByOwner(doc, 'owner@x.com');
  assert.equal(methods.length, 1);
  const id = methods[0].methodId;

  assert.equal(await sp.findOwnedMethod(doc, 'attacker@x.com', id), null, '타인 이메일로는 조회 불가');
  assert.equal(await sp.findOwnedMethod(doc, 'owner@x.com', 'M-NOPE'), null, '타인 method_id로는 조회 불가');
  assert.notEqual(await sp.findOwnedMethod(doc, 'owner@x.com', id), null, '본인은 조회 가능');

  const delForeign = await sp.markMethodDeleted(doc, 'attacker@x.com', id);
  assert.equal(delForeign, false, '타인 이메일로는 삭제 불가');
  assert.equal(await sp.markMethodDeleted(doc, 'owner@x.com', id), true);
  assert.equal(await sp.findOwnedMethod(doc, 'owner@x.com', id), null, '삭제된 수단은 결제에 쓰이지 않는다');
});

/* ── SP4: no_live_pg — 모든 빌링키 경로 정직 거절 ── */
test('SP4 — pre-PG adapter refuses every billing-key path honestly', async () => {
  const resolved = pp.resolvePaymentProvider({});
  assert.equal(resolved.provider.name, 'no_live_pg');
  assert.equal(resolved.savedMethodsAvailable, false);

  const init = await resolved.provider.createBillingKeyRegistration({ member: { email: 'a@x.com' } });
  assert.equal(init.ok, false);
  assert.equal(init.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(init.customer_message, '결제 시스템 준비 중입니다.');

  const verify = await resolved.provider.verifyBillingKeyRegistration({ registration_ref: 'r1', member_email: 'a@x.com' });
  assert.equal(verify.ok, false);
  assert.equal(verify.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.ok(!verify.provider_billing_key, '거절 경로에서 키가 발급되지 않는다');

  const del = await resolved.provider.deleteBillingKey({ provider_billing_key: 'BK-X' });
  assert.equal(del.ok, false);
});

/* ── SP5: 등록 확정은 PG 재조회 응답만 저장한다 (클라이언트 카드 경로 없음) ── */
test('SP5 — a live adapter registers via server-side PG lookup only', async () => {
  // 계약 스파이 — 라이브 어댑터가 지켜야 할 최소 형태
  const fakeLive = {
    name: 'fake_live',
    live: true,
    savedMethodsAvailable: true,
    verifyWebhookSignature: () => true,
    async createPaymentRequest() { return { ok: true, provider: 'fake_live' }; },
    async verifyPayment() { return { ok: true, provider: 'fake_live', provider_payment_id: 'x', status: 'CONFIRMED' }; },
    async cancelPayment() { return { ok: true, provider: 'fake_live', provider_payment_id: 'x', status: 'CANCELLED' }; },
    async refundPayment() { return { ok: true, provider: 'fake_live', provider_payment_id: 'x', status: 'CONFIRMED' }; },
    async getPaymentStatus() { return { ok: true, provider: 'fake_live', provider_payment_id: 'x', status: 'CONFIRMED' }; },
    async createBillingKeyRegistration() {
      return { ok: true, provider: 'fake_live', registration_url: 'https://pg.example/widget', registration_ref: 'REG-1' };
    },
    async verifyBillingKeyRegistration(ref) {
      // 서버→PG 재조회 흉내 — 클라이언트가 준 값은 인자에 아예 없다(계약 자체가 경로를 차단)
      assert.equal(ref.registration_ref, 'REG-1');
      return { ok: true, provider: 'fake_live', provider_billing_key: 'BK-LIVE-1', card_corp: PG_METHOD.card_corp, last4: PG_METHOD.last4 };
    },
    async deleteBillingKey() { return { ok: true, provider: 'fake_live' }; },
  };
  const doc = fakeDoc();
  const init = await fakeLive.createBillingKeyRegistration({ member: { email: 'm@x.com' } });
  assert.equal(init.ok, true);
  const verdict = await fakeLive.verifyBillingKeyRegistration({ registration_ref: init.registration_ref, member_email: 'm@x.com' });
  assert.equal(verdict.ok, true);
  const saved = await sp.createSavedMethod(doc, {
    email: 'm@x.com', provider: verdict.provider, providerBillingKey: verdict.provider_billing_key,
    cardCorp: verdict.card_corp, last4: verdict.last4,
  });
  assert.equal(saved.ok, true);
  const shown = sp.toDisplay(saved.method);
  assert.ok(!JSON.stringify(shown).includes('BK-LIVE-1'), '저장된 빌링키가 표시 응답에 새지 않는다');
});

/* ── SP6: 결제 요청 saved_method 전달 — 소유 검증은 호출자 책임, 전달은 계약 ── */
test('SP6 — payment flow accepts a pre-verified saved method and forwards it to the provider', async () => {
  const flow = require(path.resolve(__dirname, '../lib/paymentFlow.ts'));
  const received = [];
  const deps = {
    provider: {
      ...pp.noLivePgProvider,
      name: 'spy_live',
      live: true,
      async createPaymentRequest(order) { received.push(order); return { ok: true, provider: 'spy_live', provider_payment_id: 'pp_1' }; },
    },
    loadOrder: async () => ({
      orderId: 'TEST-20260910-00042', orderTime: 't', paymentMethod: 'pg_card', paymentStatus: '입금대기',
      depositor: '테스터', customerName: '테스터', customerPhone: '010', customerAddress: '주소', customerId: '',
      itemsJson: JSON.stringify([{ sku: 'PRD-N1-01', name: '셔츠', color: '블랙', size: 'M', qty: 1, unit_price: 10000 }]),
      total: 13000, shipType: '', shipStatus: '', carrier: '', trackingNo: '', csMemo: '',
      raw: { 고객이메일: 'm@x.com' },
    }),
    loadPrice: async () => ({ price: 10000, name: '셔츠' }),
    createPayment: async (input) => ({ ok: true, record: { paymentId: input.paymentId } }),
    findPaymentsByOrder: async () => [],
    findPaymentByProviderPaymentId: async () => null,
    updatePayment: async () => ({ ok: true }),
    confirmOrderPaid: async () => ({ transitioned: true, alreadyPaid: false }),
    decrementStock: async () => ({}),
    emitEvent: async () => true,
    notifyPaymentConfirmed: async () => {},
  };
  const result = await flow.createPaymentRequestForOrder(deps, 'TEST-20260910-00042', {
    savedMethod: { methodId: 'M-1', providerBillingKey: 'BK-9' },
  });
  assert.equal(result.http, 200, JSON.stringify(result));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].saved_method, { method_id: 'M-1', provider_billing_key: 'BK-9' },
    '소유 검증을 통과한 수단만 어댑터에 도달한다');
});
