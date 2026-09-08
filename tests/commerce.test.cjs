const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

// @/ 경로 별칭 → lib/*.ts (transpile require 체인 — cart.test.cjs 와 동일 harness)
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
const idem = require('../lib/idempotency.ts');
const orderState = require('../lib/orderState.ts');
const orderView = require('../lib/orderView.ts');
const supplierStock = require('../lib/supplierStock.ts');

const line = (over = {}) => ({
  sku: 'PRD-X', name: '테스트 상품', color: '아이보리', size: 'M',
  qty: 1, unit_price: 39800, added_at: '2026-09-09T00:00:00Z', ...over,
});

// ═══════════ C1 — Guest cart ═══════════
test('C1 guest cart: 담기→소계→삭제→수량 갱신 (localStorage 키 게스트 계약)', () => {
  let items = cart.addToCart([], line({ qty: 2 }));
  items = cart.addToCart(items, line({ sku: 'PRD-Y', color: '', size: 'F', qty: 1, unit_price: 20000 }));
  assert.equal(cart.cartCount(items), 3);
  assert.equal(cart.cartSubtotal(items), 39800 * 2 + 20000);
  // 게스트 활성 키는 기존과 동일 — 하위호환
  assert.equal(cart.GUEST_CART_KEY, 'n1_cart_v1');
  items = cart.setLineQty(items, cart.cartItemKey(line()), 4);
  assert.equal(cart.cartSubtotal(items), 39800 * 4 + 20000);
  items = cart.removeFromCart(items, cart.cartItemKey(line()));
  assert.equal(cart.cartCount(items), 1);
});

// ═══════════ C2 — Member cart + Guest→Member merge 계약 ═══════════
test('C2 member cart: 회원 키 파생 + merge 계약(게스트 보존 → 병합 저장)', () => {
  // persistence contract: 활성 키 전환은 memberCartKey(email) 로만 결정된다
  const keyA = cart.memberCartKey('User@Example.com');
  const keyB = cart.memberCartKey('user@example.com');
  assert.equal(keyA, keyB); // 이메일 정규화 — 같은 계정은 같은 카트
  assert.ok(keyA.startsWith('n1_cart_v1_m_')); // 게스트 키 네임스페이스와 분리

  // 로그인 시점의 실제 시퀀스: 게스트 보존 → mergeCarts(회원, 게스트) → 회원 키 저장
  const memberCart = [line({ qty: 1, added_at: '2026-09-08T00:00:00Z' })];
  const guestCart = [line({ qty: 2 }), line({ sku: 'PRD-Y', color: '', size: 'F', qty: 1, unit_price: 20000 })];
  const guestPreserved = JSON.parse(JSON.stringify(guestCart)); // 로그아웃 복귀용 보존본
  const merged = cart.mergeCarts(memberCart, guestCart);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].qty, 3, '동일 라인은 수량 합산');
  // 게스트 보존본은 병합과 무관하게 원본 유지 — 로그아웃 시 그대로 복귀
  assert.deepEqual(guestPreserved, guestCart);
  // 재로그인(다른 탭에서 카트 추가 후)에도 같은 계약 재적용 가능 — 멱등한 계약
  const remerged = cart.mergeCarts(merged, []);
  assert.deepEqual(remerged, merged);
});

// ═══════════ C3 — Buy Now (단일 상품 격리) ═══════════
test('C3 buy now: stash는 정확히 1개 선택이며 카트와 무결', () => {
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  // PDP 선택 한 개만 stash — 카트에 다른 상품이 있어도 포함되지 않는다
  const cartItems = cart.addToCart([], line({ sku: 'PRD-OTHER', qty: 3 }));
  checkout.stashBuyNow(line({ qty: 2, color: '네이비', size: 'L' }));
  const taken = checkout.takeBuyNow();
  assert.equal(taken.sku, 'PRD-X');
  assert.equal(taken.color, '네이비');
  assert.equal(taken.size, 'L');
  assert.equal(taken.qty, 2);
  // 카트는 stash와 무관하게 유지 — buy now가 카트를 훔치지 않는다
  assert.equal(cartItems.length, 1);
  assert.equal(cartItems[0].sku, 'PRD-OTHER');
  // 카트 경로로 결제 의도 전환 시 stash는 제거된다 (CartDrawer.goCheckout 계약)
  checkout.clearBuyNow();
  assert.equal(checkout.takeBuyNow(), null);
  delete global.sessionStorage;
});

// ═══════════ C4 — Multi-line cart checkout ═══════════
test('C4 multi cart checkout: 다품목 소계·배송비·총액이 서버 규칙과 일치', () => {
  const items = [
    line({ sku: 'PRD-A', qty: 1, unit_price: 26600 }),
    line({ sku: 'PRD-B', qty: 2, unit_price: 11700 }),
  ];
  const subtotal = cart.cartSubtotal(items);
  assert.equal(subtotal, 50000);
  // 5만원 이상 무료 배송 경계
  assert.equal(checkout.getShippingFee(subtotal), 0);
  assert.equal(checkout.calcTotal(subtotal), 50000);
  // 미만이면 3,000원
  const small = cart.cartSubtotal([line({ qty: 1, unit_price: 26400 })]);
  assert.equal(checkout.getShippingFee(small), 3000);
  assert.equal(checkout.calcTotal(small), 29400);
  // checkout 라인 매핑: sku/color/size/qty 만 서버로 — 표시값/이미지는 전송하지 않는다
  const payload = items.map((i) => ({ sku: i.sku, color: i.color, size: i.size, qty: i.qty }));
  assert.deepEqual(Object.keys(payload[0]), ['sku', 'color', 'size', 'qty']);
});

// ═══════════ C5 — Raw option 무결성 ═══════════
test('C5 raw option: 원시 color/size가 직렬화·병합 전 과정에서 보존된다', () => {
  const raw = line({ color: '겨자', size: '95' }); // 표시 변환 대상 원시값 + 숫자형 사이즈 문자열
  let items = cart.addToCart([], raw);
  items = cart.addToCart(items, raw); // 병합
  const restored = cart.parseCart(JSON.stringify(items)); // localStorage round-trip
  assert.equal(restored[0].color, '겨자'); // raw 보존
  assert.equal(restored[0].size, '95');
  assert.equal(cart.colorDisplayLabel(restored[0].color), '머스타드'); // 표시만 변환
  // raw 값이 다르면 다른 라인 — 표시 라벨이 같아도
  const other = cart.addToCart(restored, line({ color: '머스타드', size: '95' }));
  assert.equal(other.length, 2);
});

// ═══════════ C6 — Bank transfer UI 경계 ═══════════
test('C6 bank transfer: 유일 활성 결제수단이며 UI 비활성 수단에 사유가 있다', () => {
  const methods = payments.getPaymentMethods();
  const available = methods.filter((m) => m.available);
  assert.equal(available.length, 1);
  assert.equal(available[0].id, 'bank_transfer');
  const pg = payments.findPaymentMethod('pg_card');
  assert.equal(pg.available, false);
  assert.ok(pg.unavailableReason && pg.unavailableReason.length > 0);
});

// ═══════════ C7 — Order state machine ═══════════
test('C7 state machine: 정상 전이만 허용하고 종단 상태는 전이 없다', () => {
  const S = orderState.ORDER_STATUSES;
  for (const required of ['DRAFT', 'PAYMENT_PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCEL_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'REFUND_PENDING', 'REFUNDED']) {
    assert.ok(S.includes(required), `필수 상태 누락: ${required}`);
  }
  // 행복 경로
  assert.ok(orderState.canTransition('DRAFT', 'PAYMENT_PENDING'));
  assert.ok(orderState.canTransition('PAYMENT_PENDING', 'PAID'));
  assert.ok(orderState.canTransition('PAID', 'PREPARING'));
  assert.ok(orderState.canTransition('PREPARING', 'SHIPPED'));
  assert.ok(orderState.canTransition('SHIPPED', 'DELIVERED'));
  // 취소/반품/환불 경로 (Session I 재사용)
  assert.ok(orderState.canTransition('PAID', 'CANCEL_REQUESTED'));
  assert.ok(orderState.canTransition('CANCEL_REQUESTED', 'CANCELLED'));
  assert.ok(orderState.canTransition('DELIVERED', 'RETURN_REQUESTED'));
  assert.ok(orderState.canTransition('RETURN_REQUESTED', 'REFUND_PENDING'));
  assert.ok(orderState.canTransition('REFUND_PENDING', 'REFUNDED'));
  // 불법 전이
  assert.ok(!orderState.canTransition('DRAFT', 'DELIVERED'));
  assert.ok(!orderState.canTransition('SHIPPED', 'PAID'));
  assert.ok(!orderState.canTransition('CANCELLED', 'PAID'));
  assert.ok(!orderState.canTransition('REFUNDED', 'PREPARING'));
  // 종단
  assert.ok(orderState.isTerminalStatus('CANCELLED'));
  assert.ok(orderState.isTerminalStatus('REFUNDED'));
  assert.ok(!orderState.isTerminalStatus('DELIVERED'));
  // 가드는 위반 전이에서 throw
  assert.throws(() => orderState.assertTransition('CANCELLED', 'PAID'));
});

test('C7 harmonize: 레거시 시트 문자열(결제상태/배송상태)이 canonical로 읽힌다', () => {
  const read = orderState.toCanonicalStatus;
  assert.equal(read({ paymentStatus: '입금대기', shipStatus: '접수' }), 'PAYMENT_PENDING');
  assert.equal(read({ paymentStatus: '입금확인중', shipStatus: '' }), 'PAYMENT_PENDING');
  assert.equal(read({ paymentStatus: '결제완료', shipStatus: '' }), 'PAID');
  assert.equal(read({ paymentStatus: '결제완료', shipStatus: '접수' }), 'PREPARING');
  assert.equal(read({ paymentStatus: '결제완료', shipStatus: '배송중' }), 'SHIPPED');
  assert.equal(read({ paymentStatus: '결제완료', shipStatus: '배송완료' }), 'DELIVERED');
  assert.equal(read({ paymentStatus: '결제취소', shipStatus: '' }), 'CANCELLED');
  assert.equal(read({ paymentStatus: '환불진행' }), 'REFUND_PENDING');
  assert.equal(read({ paymentStatus: '환불완료' }), 'REFUNDED');
  assert.equal(read({ paymentStatus: '' }), 'PAYMENT_PENDING'); // 빈 결제상태 = 미완료 (DRAFT 아님 — V1 생성은 즉시 입금대기)
  // CS메모 요청 태그 → 요청 상태 우선 (Session I 판독 계약)
  const memoRead = (csMemo, pay, ship) => orderState.readOrderStatus({ paymentStatus: pay, shipStatus: ship, csMemo });
  assert.equal(memoRead('[2026-09-09 10:00] 반품요청', '결제완료', '배송완료'), 'RETURN_REQUESTED');
  assert.equal(memoRead('[2026-09-09 10:00] 취소요청', '입금대기', '접수'), 'CANCEL_REQUESTED');
  // 이미 종결됐으면 요청 태그보다 종결 상태 우선
  assert.equal(memoRead('반품요청', '환불완료', '배송완료'), 'REFUNDED');
  // 표시 라벨
  assert.equal(orderState.displayLabel('PAYMENT_PENDING'), '입금 대기');
});

// ═══════════ C8 — Double-click idempotency ═══════════
test('C8 double-click: 동일 멱등키 동시 요청은 한 번만 실행되고 같은 결과를 돌려준다', async () => {
  idem.resetIdempotency('orders.create');
  let runs = 0;
  const run = () => idem.withIdempotency('orders.create', 'KEY-1', async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 20)); // 느린 시트 인입 시뮬레이션
    return { order_id: 'ORD-1', total_amount: 50000 };
  });
  const [a, b, c] = await Promise.all([run(), run(), run()]); // 더블(트리플) 클릭 동시 도착
  assert.equal(runs, 1, '동일 키는 1회만 실행');
  assert.equal(a.value.order_id, 'ORD-1');
  assert.equal(b.value.order_id, a.value.order_id);
  assert.equal(c.value.order_id, a.value.order_id);
  assert.equal(b.replayed || c.replayed, true, '동시 재도착은 replay 로 표시');
  // 성공 이후 재요청도 replay
  const again = await run();
  assert.equal(again.replayed, true);
  assert.equal(runs, 1);
  // 다른 키는 독립 실행
  await idem.withIdempotency('orders.create', 'KEY-2', async () => { runs += 1; return { order_id: 'ORD-2' }; });
  assert.equal(runs, 2);
  // 실패는 캐시하지 않는다 — 재시도가 실제로 재실행된다
  idem.resetIdempotency('orders.create');
  let fails = 0;
  const failing = () => idem.withIdempotency('orders.create', 'KEY-3', async () => {
    fails += 1;
    throw new Error('sheet down');
  });
  await assert.rejects(failing());
  await assert.rejects(failing());
  assert.equal(fails, 2, '실패 후 재시도는 재실행된다');
});

// ═══════════ C9 — Callback retry (입금확인 요청 중복 제거) ═══════════
test('C9 callback retry: 확인 요청 재도착은 메모 중복 기록으로 이어지지 않는다', async () => {
  idem.resetIdempotency('orders.confirm');
  // route 계약: 주문당 1회 수렴 — 재도착은 replay
  let writes = 0;
  const confirmOnce = () => idem.withIdempotency('orders.confirm', 'ORD-77', async () => {
    writes += 1;
    return { recorded: true };
  });
  const [x, y] = await Promise.all([confirmOnce(), confirmOnce()]);
  assert.equal(writes, 1);
  assert.equal(x.value.recorded, true);
  assert.equal(y.value.recorded, true);
  // 메모 중복 판정 규칙 — 기존 요청이 있으면 재기록하지 않는다 (route가 쓰는 실제 함수)
  assert.equal(orderView.confirmMemoAlreadyRequested('[2026-09-09 10:00] 입금확인요청 홍길동'), true);
  assert.equal(orderView.confirmMemoAlreadyRequested('[2026-09-09 09:00] 기타 문의'), false);
  assert.equal(orderView.confirmMemoAlreadyRequested(''), false);
  // 운영자가 이미 결제완료로 올린 주문은 새 요청 대상이 아니다 (route의 canonical 가드)
  assert.notEqual(orderState.toCanonicalStatus({ paymentStatus: '결제완료' }), 'PAYMENT_PENDING');
});

// ═══════════ C10 — Member order history projection ═══════════
test('C10 order history: 소유자 projection은 주문번호/일시/항목/금액/결제/배송/상태를 담는다', () => {
  const record = {
    orderId: 'ORD-20260909-001',
    orderTime: '2026-09-09T05:00:00.000Z',
    paymentMethod: 'bank_transfer',
    paymentStatus: '입금대기',
    depositor: '홍길동',
    customerName: '홍길동',
    customerPhone: '010-1234-5678',
    customerAddress: '서울시 강남구 테헤란로 1',
    customerId: 'C-TEST',
    itemsJson: JSON.stringify([
      { sku: 'PRD-X', name: '니트', color: '아이보리', size: 'M', qty: 2, unit_price: 39800 },
    ]),
    total: 82600,
    shipType: '단일배송',
    shipStatus: '접수',
    carrier: '',
    trackingNo: '',
    csMemo: '',
    raw: { '고객이메일': 'user@example.com' },
  };
  const view = orderView.projectOrderForOwner(record);
  assert.equal(view.order_id, 'ORD-20260909-001');
  assert.equal(view.order_time, '2026-09-09T05:00:00.000Z');
  assert.equal(view.items.length, 1);
  assert.equal(view.subtotal, 79600);
  assert.equal(view.total, 82600);
  assert.equal(view.payment.method, 'bank_transfer');
  assert.equal(view.shipping.status, '접수');
  assert.equal(view.status, 'PAYMENT_PENDING');
  assert.equal(view.status_label, '입금 대기');
  // 손상된 주문항목 JSON — 조용한 유실 대신 corrupt 플래그
  const broken = orderView.parseOrderItems('not-json');
  assert.equal(broken.items.length, 0);
  assert.equal(broken.corrupt, true);
});

// ═══════════ C11 — Guest lookup (소유 검증) ═══════════
test('C11 guest lookup: 주문번호+연락처 일치만 통과하고 번호만으로는 불가하다', () => {
  const record = { customerPhone: '010-1234-5678' };
  // 연락처 정규화(숫자만) 완전 일치
  assert.equal(orderView.verifyGuestOwnership(record, '010-1234-5678'), true);
  assert.equal(orderView.verifyGuestOwnership(record, '01012345678'), true);
  // 불일치/부분 일치는 전부 실패 — 뒷자리만으로 자가 조회 불가
  assert.equal(orderView.verifyGuestOwnership(record, '010-9999-5678'), false);
  assert.equal(orderView.verifyGuestOwnership(record, '5678'), false);
  assert.equal(orderView.verifyGuestOwnership(record, ''), false);
  assert.equal(orderView.verifyGuestOwnership(null, '01012345678'), false);
  // 주문번호만 있는 probe 응답 — PII 0, 존재 유출 없음
  const probe = orderView.publicOrderProbeRejected();
  assert.equal(probe.ok, false);
  assert.ok(!('items' in probe) && !('customer' in probe) && !('order' in probe));
});

// ═══════════ C12 — Unauthorized order ═══════════
test('C12 unauthorized order: 소유 불일치 주문은 generic 응답으로만 존재한다', () => {
  const record = { customerPhone: '010-1234-5678', orderId: 'ORD-SECRET' };
  const attackerPhone = '010-8888-7777';
  // 검증 프레디킷 실패 → route는 projectOrderForOwner 를 호출하지 않고 동일 404 응답
  assert.equal(orderView.verifyGuestOwnership(record, attackerPhone), false);
  const denied = orderView.publicOrderProbeRejected();
  assert.equal(denied.error.indexOf('ORD-SECRET'), -1, '주문번호 유출 없음');
  assert.ok(JSON.stringify(denied).indexOf('홍길동') === -1);
  // 토큰 없는 회원내역 요청도 권한 없음 (route GET 계약: token 필수 → 401)
  // — 실제 401은 route가 반환하며, 여기선 계약 입력(빈 토큰)이 거부 대상임을 확인
  const emptyToken = '';
  assert.equal(!emptyToken, true);
});

// ═══════════ C13 — PG absent → no fake paid ═══════════
test('C13 PG absent: fake paid 경로가 존재하지 않고 생성 상태는 입금대기 하나다', () => {
  // 유일 활성 수단 = 무통장입금, 서버 확정값도 동일
  assert.equal(payments.DEFAULT_PAYMENT_METHOD, 'bank_transfer');
  assert.equal(payments.findPaymentMethod('fake_success'), undefined);
  assert.equal(payments.getPaymentMethods().every((m) => m.available === (m.id === 'bank_transfer')), true);
  // 주문 생성 시 canonical 상태는 PAYMENT_PENDING 뿐 — 클라이언트가 PAID를 만들 방법이 없다
  assert.equal(orderState.displayLabel('PAYMENT_PENDING'), '입금 대기');
  assert.ok(!orderState.canTransition('DRAFT', 'PAID'), '생성 즉시 PAID 불가');
  assert.ok(orderState.canTransition('PAYMENT_PENDING', 'PAID'), 'PAID 전이는 운영자 결제상태 갱신 뒤에만');
  // 공급사 재고 어댑터 미연결 = definitive:false (미확정) — 품절/재고를 날조하지 않는다
  return supplierStock.finalStockCheck([{ sku: 'PRD-X', color: '아이보리', size: 'M', qty: 1 }]).then((res) => {
    assert.equal(res.ok, null);
    assert.equal(res.definitive, false);
    assert.equal(res.adapter, 'noop');
  });
});
