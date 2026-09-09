/**
 * SESSION H — Stock Frontend + Checkout Integration 테스트 (H1~H8, TASKS 11·13·14)
 * 실행: node --test tests/stockIntegration.test.cjs
 * 원칙: 네트워크·시트·credential 없이 순수 로직만 검증한다 (기존 하니스와 동일).
 *
 * 검증 대상:
 *  - lib/stockDisplay.ts  — PDP "N개 남음" 파생 (verified numeric option stock만, binary/stale 창작 금지)
 *  - lib/stockGate.ts     — 결제 개시 직전 게이트 판정 + 정직 메시지 + 순수 차감 계산
 *  - B 어댑터 × C finalStockCheck 경계 접속 (registerStockAdapter 주입 시나리오)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

// @/ 경로 별칭 → lib/*.ts (commerce.test.cjs와 동일 harness)
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

const load = (rel) => require(path.resolve(__dirname, '..', rel));
const supplierStock = load('lib/supplierStock.ts');
const adapterMod = load('lib/stock/adapter.ts');
const gateMod = load('lib/stockGate.ts');
const displayMod = load('lib/stockDisplay.ts');

const NOW = new Date('2026-09-09T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const STALE_ISO = '2026-09-06T12:00:00.000Z'; // 72h 전 — FRESH_WINDOW(24h) 밖

/** 검증 레코드 fixture (lib/stock/types.ts StockRecord 형태) */
function recordFixture({ productId = 'PRD-N1-01', status = '판매중', qty = null, verifiedAt = NOW_ISO, options = [] } = {}) {
  return {
    productId,
    supplierName: '도매꾹',
    supplierProductId: '67853341',
    supplierUrl: 'https://www.domeggook.com/67853341',
    stockStatus: status,
    stockQuantity: qty,
    stockType: options.some((o) => typeof o.quantity === 'number') || typeof qty === 'number' ? 'A' : 'B',
    stockVerifiedAt: verifiedAt,
    stockSource: 'domeggook.getItemView.4.6',
    stockConfidence: 'HIGH',
    optionStock: options,
    notes: [],
  };
}
function opt(color, size, { quantity = null, available = null } = {}) {
  return {
    optionKey: color && size ? `${color}_${size}` : color || size,
    color,
    size,
    quantity,
    available,
    rawLabel: `${color}${size ? '/' + size : ''}`,
  };
}
/** B 어댑터에 ledger loader fixture를 주입하고 finalStockCheck를 실행 (서버 배선과 동일 접속) */
async function checkWithLedger(ledger, lines, now = NOW) {
  supplierStock.registerStockAdapter(adapterMod.createStockBackendAdapter(async () => ledger, now));
  return supplierStock.finalStockCheck(lines);
}

/* ── H1 exact N — 검증된 숫자 옵션 재고만 "N개 남음" ── */
test('H1 exact N — FRESH·TYPE A 옵션 수량은 그 숫자 그대로 "N개 남음"으로만 표시된다', () => {
  const view = recordFixture({ options: [opt('블랙', 'M', { quantity: 5 })] });
  const s = displayMod.pdpStockState(view, false, '블랙', 'M', NOW);
  assert.equal(s.lookup, 'ok');
  assert.equal(s.count, 5, '확인된 숫자를 왜곡 없이 보존');
  assert.equal(s.countLabel, '5개 남음');
  assert.equal(s.buyable, true, 'FRESH 숫자 ≥1 → 서버가 수락할 선택');
  assert.equal(s.capQty, 5, '수량 상한이 확인 수량으로 cap');
  assert.equal(s.fresh, true);
  const big = displayMod.pdpStockState(recordFixture({ options: [opt('블랙', 'M', { quantity: 37 })] }), false, '블랙', 'M', NOW);
  assert.equal(big.countLabel, '37개 남음');
});

/* ── H2 binary no number — binary/unknown에서 숫자 창작 금지 ── */
test('H2 binary no number — available만 있는 옵션은 수량을 만들지 않는다 (null ≠ 0)', () => {
  const binaryOk = displayMod.pdpStockState(
    recordFixture({ options: [opt('블랙', 'M', { available: true })] }), false, '블랙', 'M', NOW,
  );
  assert.equal(binaryOk.count, null, 'binary available=true — 숫자 없음');
  assert.equal(binaryOk.countLabel, null, '"N개 남음" 표시 금지');
  assert.equal(binaryOk.soldout, false);
  assert.equal(binaryOk.buyable, false, '수량 미확정 → 서버도 확정하지 않는 선택');
  const binarySoldout = displayMod.pdpStockState(
    recordFixture({ options: [opt('블랙', 'M', { available: false })] }), false, '블랙', 'M', NOW,
  );
  assert.equal(binarySoldout.count, null, 'binary 품절 — "0개 남음"으로 창작하지 않는다');
  assert.equal(binarySoldout.countLabel, null);
  assert.equal(binarySoldout.soldout, true, '확인된 품절은 품절로');
  const unknown = displayMod.pdpStockState(recordFixture({ options: [] }), false, '블랙', 'M', NOW);
  assert.equal(unknown.countLabel, null, '미스테이징(UNKNOWN) — 표시 없음');
});

/* ── H3 stale — 신선하지 않은 숫자는 count를 숨긴다 (stock_verified_at 기준) ── */
test('H3 stale — STALE 검증값은 숫자가 있어도 count를 숨기고 품절로도 만들지 않는다', () => {
  const stale = displayMod.pdpStockState(
    recordFixture({ options: [opt('블랙', 'M', { quantity: 5 })], verifiedAt: STALE_ISO }),
    false, '블랙', 'M', NOW,
  );
  assert.equal(stale.fresh, false);
  assert.equal(stale.countLabel, null, 'STALE 숫자 — count 숨김 (TASK H3)');
  assert.equal(stale.count, null);
  assert.equal(stale.buyable, false);
  assert.equal(stale.soldout, false, 'STALE은 미확인이지 품절이 아니다');
  const never = displayMod.pdpStockState(
    recordFixture({ options: [opt('블랙', 'M', { quantity: 5 })], verifiedAt: null }),
    false, '블랙', 'M', NOW,
  );
  assert.equal(never.countLabel, null, '재고검증일시 없음 = 값이 아니라 추측 — 표시 없음');
  // 서버 게이트도 STALE을 확정 판정하지 않는다 (B 어댑터 계약과 정합)
  return checkWithLedger(
    { 'PRD-N1-01': recordFixture({ options: [opt('블랙', 'M', { quantity: 0 })], verifiedAt: STALE_ISO }) },
    [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1 }],
  ).then((res) => {
    assert.equal(res.definitive, false, 'STALE 0도 "품절 확정"이 아니다');
    assert.equal(res.ok, null);
  });
});

/* ── H4 color/size change — 선택 옵션 변경에 따라 표시가 결정적으로 따라간다 ── */
test('H4 color/size change — 색상·사이즈 선택마다 해당 옵션의 검증값으로만 갱신된다', () => {
  const view = recordFixture({
    options: [
      opt('블랙', 'M', { quantity: 5 }),
      opt('블랙', 'L', { quantity: 2 }),
      opt('네이비', 'M', { available: false }),
    ],
  });
  const m = displayMod.pdpStockState(view, false, '블랙', 'M', NOW);
  assert.equal(m.countLabel, '5개 남음');
  assert.equal(m.capQty, 5);
  const l = displayMod.pdpStockState(view, false, '블랙', 'L', NOW);
  assert.equal(l.countLabel, '2개 남음', '사이즈 변경 → 해당 옵션 수량');
  assert.equal(l.capQty, 2);
  const navy = displayMod.pdpStockState(view, false, '네이비', 'M', NOW);
  assert.equal(navy.countLabel, null);
  assert.equal(navy.soldout, true, '네이비/M — 확인된 품절');
  // 색상별 확인된 사이즈 후보 — 시트 sizeOptions이 비어 있어도 옵션 완성 가능
  assert.deepEqual(displayMod.pdpStockState(view, false, '블랙', '', NOW).sizes, ['M', 'L']);
  assert.deepEqual(displayMod.pdpStockState(view, false, '네이비', '', NOW).sizes, ['M']);
  // 구매 CTA: 사이즈 미선택이면 choose, 선택하면 ready (서버가 수락할 선택만 활성화)
  assert.equal(displayMod.effectiveBuyState('unconfirmed', m, ['M', 'L'], ''), 'choose');
  assert.equal(displayMod.effectiveBuyState('unconfirmed', m, ['M', 'L'], 'M'), 'ready');
  assert.equal(displayMod.effectiveBuyState('ready', navy, ['M'], 'M'), 'soldout', '확인 품절이 시트 ready보다 우선');
});

/* ── H5 checkout available — 확정 충분 재고는 결제를 진행시킨다 ── */
test('H5 checkout available — FRESH 검증 수량 ≥ 요청이면 finalStockCheck가 통과시킨다', async () => {
  const ledger = { 'PRD-N1-01': recordFixture({ options: [opt('블랙', 'M', { quantity: 5 })] }) };
  const res = await checkWithLedger(ledger, [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 2 }]);
  assert.equal(res.definitive, true);
  assert.equal(res.ok, true);
  assert.equal(res.adapter, 'n1-stock-backend.v1');
  assert.equal(res.lines[0].available, 5);
  const gate = gateMod.gateFromStockCheck(res, [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 2, name: '블랙 셔츠' }]);
  assert.ok(gate, 'definitive → 게이트 판정 존재');
  assert.equal(gate.ok, true, '게이트 통과 — 주문(결제 개시)이 진행된다');
  assert.equal(gate.source, 'stock-pipeline');
  assert.equal(gate.message, '');
  // binary available + 상품 단위 수량 조합도 확정 통과 (옵션 행 미확인 시 상품 단위 판정 — 어댑터 규칙)
  const res2 = await checkWithLedger(
    { 'PRD-N1-02': recordFixture({ productId: 'PRD-N1-02', qty: 37 }) },
    [{ sku: 'PRD-N1-02', color: '', size: '', qty: 3 }],
  );
  assert.equal(res2.definitive, true);
  assert.equal(res2.ok, true);
});

/* ── H6 checkout soldout — 확정 품절/수량부족은 결제를 중단하고 카트를 유지한다 ── */
test('H6 checkout soldout — 확정 판정만 409로 결제를 중단, 잔여를 사실대로 알린다', async () => {
  const lines = [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 7, name: '블랙 셔츠' }];
  const res = await checkWithLedger(
    { 'PRD-N1-01': recordFixture({ options: [opt('블랙', 'M', { quantity: 5 })] }) },
    lines,
  );
  assert.equal(res.definitive, true);
  assert.equal(res.ok, false);
  const gate = gateMod.gateFromStockCheck(res, lines);
  assert.equal(gate.ok, false, '결제 중단');
  assert.equal(gate.blockReason, 'INSUFFICIENT');
  assert.equal(gate.remaining, 5);
  assert.ok(gate.message.includes('잔여 5개'), `truthful 잔여 안내: ${gate.message}`);
  // 확정 품절(available=false)
  const res2 = await checkWithLedger(
    { 'PRD-N1-01': recordFixture({ options: [opt('블랙', 'M', { available: false })] }) },
    [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1, name: '블랙 셔츠' }],
  );
  const gate2 = gateMod.gateFromStockCheck(res2, [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1, name: '블랙 셔츠' }]);
  assert.equal(gate2.blockReason, 'SOLDOUT');
  assert.ok(gate2.message.includes('품절'));
  // 클라이언트 계약 — 409 안내 문구가 카트 유지를 사실대로 말한다 (clearCart는 성공 경로에서만)
  const flow = fs.readFileSync(path.resolve(__dirname, '..', 'components/CheckoutFlow.tsx'), 'utf-8');
  assert.ok(flow.includes('장바구니는 그대로 유지됩니다'), '409 fallback copy 존재');
  const clearIdx = flow.indexOf('clearCart();');
  const okGuardIdx = flow.indexOf('if (!data.ok)');
  assert.ok(clearIdx > okGuardIdx && clearIdx !== -1, '카트 비움은 실패 가드 이후(성공 경로)에만');
});

/* ── H7 source failure — 조회 실패는 미확인/실패로만 간다 (품절 창작 금지 + 별도 fallback) ── */
test('H7 source failure — 원본 조회 실패는 품절이 아니며 PDP는 별도 truthful fallback을 쓴다', async () => {
  // 서버: 어댑터 로ader가 실패해도 finalStockCheck는 미확정(ok:null)을 돌려준다 (C 경계 계약)
  supplierStock.registerStockAdapter(
    adapterMod.createStockBackendAdapter(async () => { throw new Error('staging/ledger 도달 불가'); }, NOW),
  );
  const res = await supplierStock.finalStockCheck([{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1 }]);
  assert.equal(res.definitive, false);
  assert.equal(res.ok, null, '실패 = 미확정 (품절로 창작 금지)');
  assert.ok(res.error);
  assert.equal(gateMod.gateFromStockCheck(res, []), null, '미확정 → 파이프라인 게이트는 판정하지 않는다');
  // 폴백: C 원본(Products 옵션별재고)에 값이 없으면 "재고 미확인" — 품절 아님을 명시
  const sheetGate = gateMod.gateFromSheetStock(
    [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1, name: '블랙 셔츠' }],
    () => undefined,
  );
  assert.equal(sheetGate.ok, false);
  assert.equal(sheetGate.blockReason, 'UNCONFIRMED');
  assert.equal(sheetGate.remaining, null);
  assert.ok(sheetGate.message.includes('재고 미확인'));
  assert.ok(sheetGate.message.includes('품절이 아님'));
  // PDP: /api/stock 조회 실패 — 미확인과 구분되는 실패 안내
  const failed = displayMod.pdpStockState(null, true, '블랙', 'M', NOW);
  assert.equal(failed.lookup, 'failed');
  assert.equal(failed.countLabel, null);
  assert.equal(failed.buyable, false);
  assert.equal(failed.soldout, false, '조회 실패 ≠ 품절');
  assert.ok(displayMod.STOCK_LOOKUP_FAILURE_NOTE.includes('불러오지 못했습니다'), '실패 사실을 실패대로');
  assert.equal(displayMod.effectiveBuyState('ready', failed, [], ''), 'unconfirmed', '실패 시 구매 확정 불가');
  // TASK 14 — 정상 파이프라인에서 기존 "확인 중" copy는 제거되어 있다
  const pdp = fs.readFileSync(path.resolve(__dirname, '..', 'app/product/[id]/page.tsx'), 'utf-8');
  assert.ok(!pdp.includes('옵션 재고가 확인 중입니다'), '기촌 copy 제거 확인');
});

/* ── H8 no false reserve claim — 예약/확보를 주장하지 않는다 ── */
test('H8 no false reserve claim — 주문은 차감일 뿐 예약·확보를 말하지 않는다', async () => {
  // 어댑터는 예약 계약을 노출하지 않는다 — 우리는 어떤 시점에도 reserve를 호출/주장하지 않는다
  const a = adapterMod.createStockBackendAdapter(async () => ({}), NOW);
  assert.equal(a.reserve, undefined, 'reserve 미구현 — 재고 확보를 주장할 근거 없음');
  // 모든 고객 노출 문구에 예약/확보 주장이 없다
  const exposed = [
    gateMod.GATE_MSG.soldout({ sku: 'X', color: 'a', size: 'M', qty: 1, name: 'n' }),
    gateMod.GATE_MSG.insufficient({ sku: 'X', color: 'a', size: 'M', qty: 1, name: 'n' }, 2),
    gateMod.GATE_MSG.unconfirmed({ sku: 'X', color: 'a', size: 'M', qty: 1, name: 'n' }),
    displayMod.STOCK_LOOKUP_FAILURE_NOTE,
    ...['5개 남음', '1개 남음'],
  ].join('\n');
  for (const claim of ['예약', '확보', '보관', '선점', '막아두', 'deduct']) {
    assert.ok(!exposed.includes(claim), `노출 문구에 "${claim}" 주장 없음`);
  }
  // 차감 계산 — 근거는 "주문 차감" 기록, 검증시각은 불변 (새 검증으로 위장하지 않는다)
  const rec = recordFixture({ qty: 10, options: [opt('블랙', 'M', { quantity: 5 })] });
  const { record, changed } = gateMod.applyOrderDecrement(
    rec, [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 2 }], 'ORD-TEST-01',
  );
  assert.equal(changed, true);
  assert.equal(record.optionStock[0].quantity, 3, '옵션 수량 차감');
  assert.equal(record.stockQuantity, 8, '상품 단위 수량 차감');
  assert.equal(record.stockVerifiedAt, NOW_ISO, '검증시각 불변 — 차감은 재검증이 아니다');
  assert.ok(record.notes.some((n) => n.includes('주문 차감 ORD-TEST-01 블랙_M -2')), '차감 근거 기록');
  assert.ok(record.notes.every((n) => !n.includes('예약')), '차감 기록에 예약 주장 없음');
  // 미확인 숫자는 차감하지 않는다 — null이 숫자로 되지 않는다
  const binary = recordFixture({ options: [opt('블랙', 'M', { available: true })] });
  const r2 = gateMod.applyOrderDecrement(binary, [{ sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 1 }], 'ORD-TEST-02');
  assert.equal(r2.changed, false, '확인된 숫자가 없으면 차감하지 않는다');
  assert.equal(r2.record.optionStock[0].quantity, null, 'null 보존 — 숫자 창작 없음');
  // 실패 경로 finalStockCheck는 ok:null (품절 아님) — H7과 짝을 이루는 재확인
  supplierStock.registerStockAdapter(
    adapterMod.createStockBackendAdapter(async () => { throw new Error('x'); }, NOW),
  );
  const failed = await supplierStock.finalStockCheck([{ sku: 'X', color: '', size: '', qty: 1 }]);
  assert.notEqual(failed.ok, false, '실패를 품절로 바꾸지 않는다');
});
