const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → worktree lib/*.ts (transpile require 체인)
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

const cart = require('../lib/cart.ts');
const checkout = require('../lib/checkout.ts');
const payments = require('../lib/payments.ts');

const line = (over = {}) => ({
  sku: 'PRD-X', name: '테스트 상품', color: '아이보리', size: 'M',
  qty: 1, unit_price: 39800, added_at: '2026-09-09T00:00:00Z', ...over,
});
const key = (over = {}) => cart.cartItemKey(line(over));

// ── CASE 1: Guest Add to Cart
test('add creates a cart line from a single selection', () => {
  const items = cart.addToCart([], line());
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, 'PRD-X');
  assert.equal(items[0].color, '아이보리');
});

// ── CASE 6/7: 옵션 identity 보존 + 수량 병합
test('same product+color+size merges quantity, different option stays separate', () => {
  let items = cart.addToCart([], line({ qty: 2 }));
  items = cart.addToCart(items, line({ qty: 1 })); // 동일 라인 → 병합
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 3);
  items = cart.addToCart(items, line({ qty: 1, color: '네이비' })); // 다른 옵션 → 별도 라인
  assert.equal(items.length, 2);
  // 원시 값 보존: 표시 라벨과 무관하게 raw 값 유지 (미션 §8)
  assert.equal(items[0].color, '아이보리');
  assert.equal(cart.colorDisplayLabel('겨자'), '머스타드'); // 표시만 변환
  assert.equal(cart.colorDisplayLabel('아이보리'), '아이보리');
});

test('merge is capped at MAX_QTY_PER_LINE (server cap parity)', () => {
  let items = cart.addToCart([], line({ qty: 9 }));
  items = cart.addToCart(items, line({ qty: 5 }));
  assert.equal(items[0].qty, cart.MAX_QTY_PER_LINE);
  assert.equal(cart.MAX_QTY_PER_LINE, 10);
});

// ── CASE 5: Remove
test('remove drops only the matching line', () => {
  let items = cart.addToCart([], line());
  items = cart.addToCart(items, line({ color: '네이비' }));
  items = cart.removeFromCart(items, key());
  assert.equal(items.length, 1);
  assert.equal(items[0].color, '네이비');
});

// ── CASE 6: Quantity change
test('setQty clamps to 1..10', () => {
  let items = cart.addToCart([], line({ qty: 2 }));
  items = cart.setLineQty(items, key(), 0);
  assert.equal(items[0].qty, 1);
  items = cart.setLineQty(items, key(), 99);
  assert.equal(items[0].qty, 10);
});

// ── CASE 2: refresh 생존 — localStorage 직렬화 round-trip + 변조 방어
test('cart survives serialization round-trip and rejects corrupt data', () => {
  const items = cart.addToCart([], line({ qty: 2 }));
  const raw = JSON.stringify(items);
  const restored = cart.parseCart(raw);
  assert.deepEqual(restored, items);
  assert.deepEqual(cart.parseCart('not-json'), []);
  assert.deepEqual(cart.parseCart('{"sku":1}'), []);
  assert.deepEqual(cart.parseCart(null), []);
  const patched = cart.parseCart(JSON.stringify([{ ...items[0], qty: 999 }]));
  assert.equal(patched[0].qty, 10); // 상한 클램프
});

// ── CASE 3: Guest → Login → merge (deterministic)
test('mergeCarts combines guest+member deterministically with capped quantities', () => {
  const member = [line({ qty: 2, added_at: '2026-09-09T10:00:00Z' })];
  const guest = [line({ qty: 3, added_at: '2026-09-09T09:00:00Z' }), line({ sku: 'PRD-Y', name: '다른 상품', color: '', size: 'F', qty: 1 })];
  const merged = cart.mergeCarts(member, guest);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].qty, 5); // 동일 라인 수량 병합
  assert.equal(merged[0].unit_price, line().unit_price); // 더 이른 guest 스냅샷(09:00) 유지
  assert.equal(merged[1].sku, 'PRD-Y'); // guest 신규 라인 보존
  // 교환 법칙: 순서를 바꿔도 라인 수/합산 수량 동일
  const merged2 = cart.mergeCarts(guest, member);
  assert.equal(merged2.length, 2);
  const bySku = (arr) => Object.fromEntries(arr.map((i) => [i.sku, i.qty]));
  assert.deepEqual(bySku(merged), bySku(merged2));
});

// ── CASE 8: Buy Now stash — 현재 선택만, 카트와 분리
test('buy now stash stores exactly one selection and clears', () => {
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(checkout.takeBuyNow(), null);
  checkout.stashBuyNow(line({ qty: 2 }));
  const taken = checkout.takeBuyNow();
  assert.equal(taken.sku, 'PRD-X');
  assert.equal(taken.qty, 2);
  assert.equal(taken.color, '아이보리'); // raw 값 유지
  checkout.clearBuyNow();
  assert.equal(checkout.takeBuyNow(), null);
  delete global.sessionStorage;
});

// ── CASE 9/14: 배송비 규칙 + 결제 경계
test('shipping fee: 3,000원, 5만원 이상 무료', () => {
  assert.equal(checkout.getShippingFee(30000), 3000);
  assert.equal(checkout.getShippingFee(50000), 0);
  assert.equal(checkout.calcTotal(30000), 33000);
});

test('payment boundary: PG는 준비 중으로 표시되고 fake success 수단이 없다', () => {
  const methods = payments.getPaymentMethods();
  const bank = methods.find((m) => m.id === 'bank_transfer');
  const pg = methods.find((m) => m.id === 'pg_card');
  assert.equal(bank.available, true); // V1 유일 실결제 수단
  assert.equal(pg.available, false); // PG 미연결 — 비활성
  assert.ok(pg.unavailableReason && pg.unavailableReason.includes('준비 중'));
  assert.equal(payments.findPaymentMethod('fake_success'), undefined);
  assert.equal(payments.DEFAULT_PAYMENT_METHOD, 'bank_transfer'); // 서버 확정값
});
