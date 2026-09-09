/**
 * SESSION I — Returns + Info UX 테스트 (I1~I7, TASKS 15·16·17)
 * 실행: node --test tests/returns.test.cjs
 * 원칙: 네트워크·시트·credential 없이 순수 로직만 검증한다 (기존 하니스와 동일).
 *
 * 검증 대상:
 *  - lib/returnRequest.ts — 소유 검증(회원/게스트), 상태머신 재사용 판정, 상품 검증,
 *    접수 row 계약, 자동 승인 부재 (submitReturnRequest 의존성 주입으로 전 경로)
 *  - lib/display.ts       — PDP 교환·반품 문구(승인 문구 문단 분리)·문의 위치 좌측 수정
 *  - 실제 위젯/화면 CSS   — 고객센터 위치(좌측)·모바일 대응 정적 계약 (I6·I7)
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

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => require(path.join(ROOT, rel));
const returns = load('lib/returnRequest.ts');
const display = load('lib/display.ts');
const orderState = load('lib/orderState.ts');

// ── 공통 fixture ──

const NOW = new Date('2026-09-09T12:00:00.000Z');

const ORDER_ITEMS_JSON = JSON.stringify([
  { sku: 'PRD-N1-01', name: '블랙 셔츠', color: '블랙', size: '95', qty: 2, unit_price: 19600 },
  { sku: 'PRD-N1-09', name: '스트레이트 데님', color: '진청', size: '100', qty: 1, unit_price: 32100 },
]);

function orderFixture({ paymentStatus = '결제완료', shipStatus = '배송완료', csMemo = '', orderEmail = '', phone = '010-1234-5678' } = {}) {
  return {
    itemsJson: ORDER_ITEMS_JSON,
    paymentStatus,
    shipStatus,
    csMemo,
    customerId: 'C-TEST-01',
    customerPhone: phone,
    orderEmail,
  };
}

function depsFixture({ order, sessions = {}, persistFail = false } = {}) {
  const appended = [];
  const deps = {
    findOrder: async () => order ?? null,
    findSession: (t) => sessions[t],
    appendRequest: async (row) => {
      if (persistFail) return false;
      appended.push(row);
      return true;
    },
    now: () => NOW,
  };
  return { deps, appended };
}

const MEMBER_TOKEN = 'tok-member';
const OTHER_TOKEN = 'tok-other';

// ═══════════════ I1 — 회원 경로 ═══════════════

test('I1 회원: 세션 이메일 ≡ 주문 고객이메일 → 접수 성공, Return_Requests에 1행', async () => {
  const order = orderFixture({ orderEmail: 'Buyer@Example.com' });
  const { deps, appended } = depsFixture({
    order,
    sessions: { [MEMBER_TOKEN]: 'buyer@example.com' },
  });
  const result = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-20260909-001',
    token: MEMBER_TOKEN,
    type: 'return',
    reason_code: 'SIZE',
    note: '  헐렁해요  ',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.request_id, /^RET-20260909-/);
  assert.equal(result.request.status, '접수됨');
  assert.equal(result.request.channel, '회원');
  assert.equal(result.request.type_label, '반품');

  assert.equal(appended.length, 1, '접수 원장에는 정확히 1행');
  const row = appended[0];
  assert.equal(row['주문번호'], 'ORD-20260909-001');
  assert.equal(row['접수경로'], '회원');
  assert.equal(row['상태'], '접수됨');
  assert.equal(row['주문상태(접수시)'], 'DELIVERED');
  assert.equal(row['메모'], '헐렁해요'); // trim 정리만 — 내용 변경 없음
  const items = JSON.parse(row['상품']);
  assert.equal(items[0].sku, 'PRD-N1-01');
  assert.equal(items[0].qty, 1);
});

test('I1 회원: 이메일 정규화(대소문자) 일치 처리', () => {
  const kind = returns.verifyRequestOwnership(
    { token: MEMBER_TOKEN },
    { orderEmail: 'BUYER@example.com ', orderPhone: '01012345678' },
    (t) => (t === MEMBER_TOKEN ? 'buyer@example.com' : undefined),
  );
  assert.equal(kind, 'member');
});

// ═══════════════ I2 — 게스트 경로 ═══════════════

test('I2 게스트: 주문번호+연락처 완전 일치 → 접수 성공 (교환 유형)', async () => {
  const order = orderFixture({ orderEmail: '', phone: '010-1234-5678' });
  const { deps, appended } = depsFixture({ order });
  const result = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-20260909-002',
    phone: '01012345678', // 하이픈 제거 정규화 후 완전 일치
    type: 'exchange',
    reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-09', color: '진청', size: '100', qty: 1 }],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(appended.length, 1);
  assert.equal(appended[0]['접수경로'], '게스트');
  assert.equal(appended[0]['유형'], '교환');
  assert.equal(appended[0]['사유'], '사이즈 교환');
  assert.equal(result.request.items[0].name, '스트레이트 데님');
});

test('I2 게스트: 뒷자리 부분 일치(4자리)로는 통과하지 않는다', () => {
  const kind = returns.verifyRequestOwnership(
    { phone: '5678' },
    { orderEmail: '', orderPhone: '010-1234-5678' },
    () => undefined,
  );
  assert.equal(kind, null);
});

// ═══════════════ I3 — 소유 불일치 ═══════════════

test('I3 잘못된 소유: 타 계정 토큰 / 불일치 연락처 / 미존재 → 동일 generic 404 (PII 0)', async () => {
  const order = orderFixture({ orderEmail: 'buyer@example.com', phone: '010-1234-5678' });
  const { deps } = depsFixture({ order, sessions: { [OTHER_TOKEN]: 'attacker@example.com' } });

  // 타 계정 회원 토큰 — 게스트 폴백 없이 거절
  const r1 = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-20260909-003', token: OTHER_TOKEN, type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  // 불일치 연락처
  const r2 = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-20260909-003', phone: '01099999999', type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  // 미존재 주문
  const depsNone = depsFixture({ order: null });
  const r3 = await returns.submitReturnRequest(depsNone.deps, {
    order_id: 'ORD-NONE', phone: '01012345678', type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  // 인증 수단 자체가 없음
  const r4 = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-20260909-003', type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });

  for (const r of [r1, r2, r3, r4]) {
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.equal(r.error, '주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다');
    // 존재 유출 없음: 미존재와 불일치가 같은 문구 — 주문번호·고객명·이메일 어떤 것도 포함하지 않는다
    assert.ok(!r.error.includes('ORD-') && !r.error.includes('@'));
  }
});

// ═══════════════ I4 — 부적격 주문 상태 (C 상태머신 재사용) ═══════════════

test('I4 상태 판정: SHIPPED/DELIVERED만 요청 가능 — canTransition(RETURN_REQUESTED) 재사용', () => {
  assert.equal(returns.canRequestReturnExchange('DELIVERED'), true);
  assert.equal(returns.canRequestReturnExchange('SHIPPED'), true);
  assert.equal(returns.canRequestReturnExchange('PAYMENT_PENDING'), false);
  assert.equal(returns.canRequestReturnExchange('PAID'), false);
  assert.equal(returns.canRequestReturnExchange('PREPARING'), false);
  assert.equal(returns.canRequestReturnExchange('RETURN_REQUESTED'), false); // 재요청 불가
  assert.equal(returns.canRequestReturnExchange('REFUND_PENDING'), false);
  assert.equal(returns.canRequestReturnExchange('REFUNDED'), false);
  assert.equal(returns.canRequestReturnExchange('CANCELLED'), false);
  // 판정 근거가 C의 전이 테이블 그 자체인지 — 위임 검증
  for (const s of orderState.ORDER_STATUSES) {
    assert.equal(
      returns.canRequestReturnExchange(s),
      orderState.canTransition(s, 'RETURN_REQUESTED'),
      `상태 ${s} 판정이 orderState와 불일치`,
    );
  }
});

test('I4 부적격 상태 제출 → 409 + truthful 메시지, 접수 없음', async () => {
  const cases = [
    { paymentStatus: '입금대기', shipStatus: '접수' },           // PAYMENT_PENDING
    // 주의: '출고준비중'은 C 판독기가 '출고' 키워드로 SHIPPED로 읽는다 — PREPARING 재현은 '상품준비중'
    { paymentStatus: '결제완료', shipStatus: '상품준비중' },     // PREPARING
  ];
  for (const c of cases) {
    const order = orderFixture({ ...c, orderEmail: 'buyer@example.com' });
    const { deps, appended } = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } });
    const result = await returns.submitReturnRequest(deps, {
      order_id: 'ORD-X', token: MEMBER_TOKEN, type: 'return', reason_code: 'SIZE',
      items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.ok(result.error.length > 0);
    assert.equal(appended.length, 0, '부적격 상태는 접수 기록도 남지 않는다');
  }
});

test('I4 이미 요청됨(운영자 CS메모 반품요청 태그) → readOrderStatus 판독으로 재요청 차단', async () => {
  const order = orderFixture({
    paymentStatus: '결제완료', shipStatus: '배송완료',
    csMemo: '2026-09-08 반품요청 접수됨', orderEmail: 'buyer@example.com',
  });
  const { deps } = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } });
  const result = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-Y', token: MEMBER_TOKEN, type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.ok(result.error.includes('이미 반품·교환 요청이 접수'));
});

// ═══════════════ I5 — 접수 영속성·무결성 + 자동 승인 부재 ═══════════════

test('I5 접수 영속성: append 성공 1회 / 실패 시 정직한 500 (성공 위장 금지)', async () => {
  const order = orderFixture({ orderEmail: 'buyer@example.com' });
  const okCase = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } });
  const r1 = await returns.submitReturnRequest(okCase.deps, {
    order_id: 'ORD-P1', token: MEMBER_TOKEN, type: 'return', reason_code: 'CHANGE_OF_MIND',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 2 }],
  });
  assert.equal(r1.ok, true);
  assert.equal(okCase.appended.length, 1);

  const failCase = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } , persistFail: true });
  const r2 = await returns.submitReturnRequest(failCase.deps, {
    order_id: 'ORD-P2', token: MEMBER_TOKEN, type: 'return', reason_code: 'CHANGE_OF_MIND',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 500);
});

test('I5 접수 row 계약: app 소유 Return_Requests 스키마 — Orders 시트 컬럼 침범 없음', () => {
  const row = returns.buildReturnRequestRow({
    now: NOW, orderId: 'ORD-S', customerId: 'C-1', channel: 'guest',
    type: 'return', reasonCode: 'DEFECT', reasonLabelText: '상품 불량·파손',
    note: '이음새 터짐', lines: [{ sku: 'S1', name: '니트', color: '네이비', size: '100', qty: 1 }],
    orderStatusAtRequest: 'DELIVERED',
  });
  const headers = returns.RETURN_REQUEST_HEADERS;
  for (const key of Object.keys(row)) assert.ok(headers.includes(key), `스키마 외 컬럼: ${key}`);
  for (const h of headers) assert.ok(h in row, `누락 컬럼: ${h}`);
  // Orders 시트 컬럼(주문 상태를 바꾸는 열)을 이 원장이 건드리지 않는다
  for (const forbidden of ['결제상태', '배송상태', 'CS메모']) {
    assert.ok(!(forbidden in row), `Orders 컬럼 ${forbidden} 침범`);
  }
  assert.equal(returns.RETURN_REQUESTS_SHEET, 'Return_Requests');
  assert.notEqual(returns.RETURN_REQUESTS_SHEET, 'Orders');
});

test('I5 자동 refund 승인 부재: 접수 결과는 REFUND 계열 전이를 만들지 않는다', async () => {
  const order = orderFixture({ orderEmail: 'buyer@example.com' });
  const { deps, appended } = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } });
  const result = await returns.submitReturnRequest(deps, {
    order_id: 'ORD-NOAUTO', token: MEMBER_TOKEN, type: 'return', reason_code: 'SIZE',
    items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  assert.equal(result.ok, true);
  const row = appended[0];
  // 상태는 '접수됨' — 환불 확정·승인 문구가 아니라는 것
  assert.equal(row['상태'], '접수됨');
  assert.ok(!row['상태'].includes('환불') && !row['상태'].includes('완료'));
  // 안내 문구도 승인을 주장하지 않는다
  assert.ok(result.message.includes('접수'));
  assert.ok(!result.message.includes('환불이 완료') && !result.message.includes('승인되었습니다'));
  // 접수시 스냅샷 상태는 DELIVERED 그대로 — 상태 전이는 일어나지 않았다
  assert.equal(row['주문상태(접수시)'], 'DELIVERED');
});

test('I5 상품 검증: 주문에 없는 라인·수량 초과·빈 선택 거절', async () => {
  const order = orderFixture({ orderEmail: 'buyer@example.com' });
  const { deps } = depsFixture({ order, sessions: { [MEMBER_TOKEN]: 'buyer@example.com' } });
  const base = { order_id: 'ORD-V', token: MEMBER_TOKEN, type: 'return', reason_code: 'SIZE' };

  const wrongItem = await returns.submitReturnRequest(deps, {
    ...base, items: [{ sku: 'PRD-N1-01', color: '블랙', size: '100', qty: 1 }], // 사이즈 불일치 라인
  });
  assert.equal(wrongItem.status, 400);
  assert.ok(wrongItem.error.includes('주문에 없는 상품'));

  const overQty = await returns.submitReturnRequest(deps, {
    ...base, items: [{ sku: 'PRD-N1-09', color: '진청', size: '100', qty: 5 }],
  });
  assert.equal(overQty.status, 400);
  assert.ok(overQty.error.includes('초과'));

  const empty = await returns.submitReturnRequest(deps, { ...base, items: [] });
  assert.equal(empty.status, 400);

  const badReason = await returns.submitReturnRequest(deps, {
    ...base, reason_code: 'NOT_A_REASON', items: [{ sku: 'PRD-N1-01', color: '블랙', size: '95', qty: 1 }],
  });
  assert.equal(badReason.status, 400);
});

// ═══════════════ I6 — PDP copy (승인 문구 문단 분리 + 문의 위치 좌측) ═══════════════

test('I6 교환·반품 문구: 승인 문장 3개가 그대로 순서 보존되어 문단 분리 — 의미 변경 0', () => {
  const paragraphs = display.noticeQualityParagraphs();
  assert.deepEqual(paragraphs, [
    '수령 후 7일 이내에 청약철회를 요청하실 수 있습니다.',
    '이미 사용했거나 훼손된 상품은 청약철회 대상에서 제외됩니다.',
    '전자상거래법상 소비자 청약철회 가능 범위를 준수합니다.',
  ]);
  // 기존 승인 단일 문자열과 내용 동일(공백 제외) — 단락 구분만 추가
  const joined = paragraphs.join(' ');
  assert.ok(joined.startsWith('수령 후 7일 이내에'));
  assert.ok(joined.endsWith('준수합니다.'));
  // 구 시트 문구 → 신규 승인 문구 매핑 유지
  assert.equal(
    display.noticeQualityParagraphs('전자상거래 법에 규정되어 있는 소비자 청약철회 가능 범위를 준수합니다.').length,
    3,
  );
  // 시트가 새 문구를 주면 그대로 통과(문단 임의 분리 없음)
  assert.deepEqual(display.noticeQualityParagraphs('새 승인 문구'), ['새 승인 문구']);
  // 하위호환: 단일 문자열 API는 문단을 빈 줄로 연결
  assert.ok(display.noticeQualityText().includes('\n\n'));
});

test('I6 문의 위치: 안내 문구가 "하단 좌측" — 실제 고객센터 위젯(.cs-fab) 좌측 고정과 일치', () => {
  const asText = display.noticeAsText();
  assert.ok(asText.includes('페이지 하단 좌측'), `좌측 문구 없음: ${asText}`);
  assert.ok(!asText.includes('우측'), '우측 문구 잔존 — 실제 위치와 불일치');
  // 구 카탈로그 fallback 문구도 신규 표기로 정규화
  const mapped = display.noticeAsText('N°1 고객센터 (상품 문의는 페이지 하단 문의하기 이용)');
  assert.ok(mapped.includes('페이지 하단 좌측'));

  // 실제 위치 실측(정적 계약): cs-fab은 left 고정, 장바구니(.float-bar)와 x축 미러
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  const fab = css.match(/\.cs-fab\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(fab.includes('position: fixed'), 'cs-fab fixed 아님');
  assert.ok(fab.includes('left:'), 'cs-fab left anchor 아님 (좌측 위젯이어야 함)');
  const mobileFab = css.match(/@media \(max-width: 640px\)\s*\{\s*\.cs-fab\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(mobileFab.includes('left: 16px'), '모바일 cs-fab 좌측 고정 아님');
  const floatBar = css.match(/\.float-bar\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(floatBar.includes('right:'), 'float-bar(장바구니)는 우측이어야 미러 구조');

  // PDP가 문단 렌더링을 사용하는지 (소스 실측)
  const pdp = fs.readFileSync(path.join(ROOT, 'app', 'product', '[id]', 'page.tsx'), 'utf8');
  assert.ok(pdp.includes('noticeQualityParagraphs'), 'PDP가 문단 렌더링 미사용');
  assert.ok(!pdp.includes('noticeQualityText('), 'PDP에 단일 문자열 렌더 잔존');
  const pdpCss = fs.readFileSync(path.join(ROOT, 'app', 'product', '[id]', 'product.module.css'), 'utf8');
  assert.ok(pdpCss.includes('.quality p { line-height: 1.85; }'), '교환·반품 문단 line-height 개선 없음');
  assert.ok(/\.quality p \+ p \{ margin-top: 10px; \}/.test(pdpCss), '문단 간격 없음');
});

// ═══════════════ I7 — 모바일 ═══════════════

test('I7 모바일: 주문조회·요청 화면 640px 대응 + PDP 문단 간격 유지', () => {
  const css = fs.readFileSync(path.join(ROOT, 'components', 'OrderReturns.module.css'), 'utf8');
  const mobile = css.match(/@media \(max-width: 640px\)\s*\{[\s\S]*\}/)?.[0] || '';
  assert.ok(mobile.length > 0, '모바일 media query 없음');
  // 핵심 모바일 규칙 — 폭 좁은 화면에서 요청 플로우가 깨지지 않는 구조
  assert.ok(mobile.includes('.itemRow'), '주문 항목 row 스택 규칙 없음');
  assert.ok(mobile.includes('.flowNav'), '요청 플로우 하단 네비 규칙 없음');
  assert.ok(mobile.includes('.pickerQty'), '상품 선택 수량 컨트롤 규칙 없음');
  assert.ok(mobile.includes('.guestForm'), '게스트 폼 전폭 규칙 없음');

  // PDP 문단 간격도 모바일에서 유지(8px) — 모바일 블록 안의 규칙 문자열 실측
  const pdpCss = fs.readFileSync(path.join(ROOT, 'app', 'product', '[id]', 'product.module.css'), 'utf8');
  assert.ok(pdpCss.includes('@media (max-width: 640px)'), '모바일 media query 없음');
  assert.ok(
    pdpCss.includes('.quality p + p { margin-top: 8px; }'),
    '모바일 문단 간격 규칙 없음',
  );

  // 페이지 진입점 실존
  const page = fs.readFileSync(path.join(ROOT, 'app', 'orders', 'page.tsx'), 'utf8');
  assert.ok(page.includes('OrderReturns'), '/orders 페이지가 컴포넌트를 렌더하지 않음');
  const comp = fs.readFileSync(path.join(ROOT, 'components', 'OrderReturns.tsx'), 'utf8');
  // 요청 플로우 단계 계약: product → type → reason → note → 제출 → 상태
  for (const step of ['"product"', '"type"', '"reason"', '"note"']) {
    assert.ok(comp.includes(step), `플로우 단계 ${step} 없음`);
  }
  assert.ok(comp.includes('반품·교환 요청'), '요청 진입 버튼 없음');
  assert.ok(comp.includes('/api/orders/return-request'), '요청 API 미연결');
  assert.ok(comp.includes('/api/orders/lookup'), '게스트 검증 조회 미연결');
});
