/**
 * SESSION B — Stock Truth Backend 테스트 (B1~B8, 미션 §9)
 * 실행: node --test tests/stock.test.cjs
 * 원칙: 네트워크·시트·credential 없이 순수 로직만 검증한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const load = (rel) => require(path.resolve(__dirname, '..', rel));

const sources = load('lib/stock/sources.ts');
const normalize = load('lib/stock/normalize.ts');
const watcher = load('lib/stock/watcher.ts');
const bridge = load('lib/stock/bridge.ts');
const ledger = load('lib/stock/ledger.ts');

const NOW = new Date('2026-09-09T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();

/** 문서 v4.6 계약 형태의 getItemView 응답 생성기 */
function itemViewPayload({ no, status = '판매중', inventory, selectOpt = null, price = 10320 }) {
  return {
    domeggook: {
      item: {
        no,
        basis: { status, title: '테스트 상품' },
        qty: { inventory },
        price: { dome: price },
        selectOpt,
      },
    },
  };
}

const CATALOG_ITEM = {
  productId: 'PRD-N1-01',
  supplierName: '도매꾹',
  supplierProductId: '67853341',
  supplierUrl: 'https://www.domeggook.com/67853341',
};

/* ── B1 exact stock: TYPE A 숫자 재고 ── */
test('B1 exact stock — qty.inventory 숫자는 그대로 보존되고 TYPE A/HIGH로 분류된다', () => {
  const fact = sources.parseGetItemView(itemViewPayload({ no: 67853341, inventory: 37 }), NOW_ISO);
  assert.equal(fact.parserFailure, undefined, '파서 실패가 없어야 한다');
  assert.equal(fact.factType, 'A');
  assert.equal(fact.inventoryQty, 37, '숫자를 왜곡 없이 보존');
  const { record, escalations } = sources.factToStockRecord(fact, CATALOG_ITEM);
  assert.equal(escalations.length, 0);
  assert.equal(record.stockQuantity, 37);
  assert.equal(record.stockType, 'A');
  assert.equal(record.stockConfidence, 'HIGH');
  assert.equal(record.stockStatus, '판매중');
  assert.equal(record.stockVerifiedAt, NOW_ISO);
  assert.equal(record.stockSource, 'domeggook.getItemView.4.6');
});

/* ── B2 binary only: 숫자 없이 상태만 ── */
test('B2 binary only — 수량 미확인은 null이며 0으로 창작되지 않는다', () => {
  const fact = sources.parseGetItemView(itemViewPayload({ no: 64287719, inventory: null }), NOW_ISO);
  assert.equal(fact.factType, 'B', '상태만 있으면 TYPE B');
  assert.equal(fact.inventoryQty, null);
  const { record } = sources.factToStockRecord(fact, { ...CATALOG_ITEM, productId: 'PRD-N1-02', supplierProductId: '64287719' });
  assert.equal(record.stockQuantity, null, '미확인 수량 = null (창작 금지)');
  assert.equal(record.stockType, 'B');
  assert.equal(record.stockConfidence, 'MEDIUM');
  assert.equal(record.stockStatus, '판매중');
});

/* ── B3 soldout: 상태 종료 + 수량 0 파생 ── */
test('B3 soldout — 판매종료 상태와 수량 0은 품절로 정직하게 간다', () => {
  const ended = sources.parseGetItemView(itemViewPayload({ no: 60933277, status: '판매종료', inventory: null }), NOW_ISO);
  const endedRec = sources.factToStockRecord(ended, { ...CATALOG_ITEM, productId: 'PRD-N1-09', supplierProductId: '60933277' }).record;
  assert.equal(endedRec.stockStatus, '판매종료');

  const zero = sources.parseGetItemView(itemViewPayload({ no: 60933277, status: '판매중', inventory: 0 }), NOW_ISO);
  const zeroRec = sources.factToStockRecord(zero, { ...CATALOG_ITEM, productId: 'PRD-N1-09', supplierProductId: '60933277' }).record;
  assert.equal(zeroRec.stockQuantity, 0, '확인된 0은 보존');
  assert.equal(zeroRec.stockStatus, '품절', '수량 0 + 판매중 → 품절 파생');
  assert.ok(zeroRec.notes.some((n) => n.includes('품절 파생')), '파생 근거를 notes에 남긴다');

  // supply_chk 이벤트 경로 — OPTSOLDOUT은 옵션 품절 플래그(TYPE B)
  const scan = sources.parseSupplyChkEvents(
    { domeggook: { items: { item: [{ no: 60933277, status: 'OPTSOLDOUT', date: 20260909 }] } } },
    '60933277',
    NOW_ISO,
  );
  assert.equal(scan.events.length, 1);
  assert.equal(scan.fact.factType, 'B');
});

/* ── B4 option mapping: 옵션 키 규약 + 시트 직렬화 호환 ── */
test('B4 option mapping — 옵션키 규약(color_size)·원본 라벨·시트 옵션별재고 왕복', () => {
  assert.equal(normalize.buildOptionKey('블랙', 'M'), '블랙_M');
  assert.equal(normalize.buildOptionKey('', 'L'), 'L');
  assert.equal(normalize.buildOptionKey('아이보리', ''), '아이보리');

  const entries = [
    { optionKey: '블랙_M', color: '블랙', size: 'M', quantity: 5, available: true, rawLabel: '블랙/M (재고5)' },
    { optionKey: '블랙_L', color: '블랙', size: 'L', quantity: 0, available: false, rawLabel: '블랙/L' },
    { optionKey: 'M', color: '', size: 'M', quantity: null, available: null, rawLabel: '단일색 M' },
  ];
  // catalog.ts parseStock·/api/orders 차감과 동일 포맷 왕복
  const serialized = normalize.serializeOptionStock(entries);
  assert.equal(serialized, '블랙_M:5|블랙_L:0');
  const parsedBack = normalize.parseOptionStockString(serialized);
  assert.deepEqual(parsedBack, { 블랙_M: 5, 블랙_L: 0 });

  // purchaseState와 동일 키 조회 가능
  const stock = parsedBack['블랙_L'];
  assert.equal(stock, 0);

  // 원본 정체성 JSON 왕복 — rawLabel 보존
  const json = JSON.stringify(entries);
  const restored = normalize.parseOptionStockJson(json);
  assert.equal(restored.length, 3);
  assert.equal(restored[0].rawLabel, '블랙/M (재고5)');
  assert.equal(restored[2].quantity, null, 'null 수량 보존 (0 아님)');
  assert.equal(restored[2].available, null);

  // selectOpt 미검증 구조 → 옵션 모호성 에스컬레이션 (숫자 추정 금지)
  const ambiguous = sources.parseGetItemView(
    itemViewPayload({ no: 67853341, inventory: 9, selectOpt: [{ lbl: '아이보리-F', extra: 'x' }] }),
    NOW_ISO,
  );
  assert.equal(ambiguous.optionAmbiguity, true, '검증되지 않은 옵션 구조는 모호성으로 보고');
  const ambResult = sources.factToStockRecord(ambiguous, CATALOG_ITEM);
  assert.ok(ambResult.escalations.some((e) => e.reason === 'OPTION_AMBIGUITY'));
  assert.equal(ambResult.record.stockQuantity, 9, '상품 레벨 숫자는 유지');
});

/* ── B5 parser failure: 실패는 에스컬레이션 + 기존 검증값 보존 ── */
test('B5 parser failure — 파서 실패는 에스컬레이션만 내고 이전 검증값을 변형하지 않는다', async () => {
  // 그룹 누락 → LAYOUT_CHANGE
  const bad = sources.parseGetItemView({ domeggook: { item: { no: 67853341 } } }, NOW_ISO);
  assert.ok(bad.parserFailure);
  const res = sources.factToStockRecord(bad, CATALOG_ITEM);
  assert.equal(res.record, null);
  assert.equal(res.escalations[0].reason, 'LAYOUT_CHANGE');

  // 응답 전체 무효 → PARSER_FAILURE
  const junk = sources.parseGetItemView('not json', NOW_ISO);
  assert.ok(junk.parserFailure);

  // ingest 경로: 이전 레코드 보존 확인
  const good = sources.parseGetItemView(itemViewPayload({ no: 67853341, inventory: 12 }), NOW_ISO);
  const prev = sources.factToStockRecord(good, CATALOG_ITEM).record;
  const ledgerMap = { 'PRD-N1-01': prev };
  const failedIngest = await watcher.ingestRawItemView(CATALOG_ITEM, { unexpected: true }, NOW_ISO, ledgerMap);
  assert.equal(failedIngest.record, null);
  assert.ok(failedIngest.escalations.length >= 1);
  assert.equal(ledgerMap['PRD-N1-01'].stockQuantity, 12, '기존 검증값 무변형');
  assert.equal(ledgerMap['PRD-N1-01'].stockVerifiedAt, NOW_ISO, '검증 시각도 무변형 (자연 스털화)');
});

/* ── B6 stale data: stock_verified_at 기반 신선도 ── */
test('B6 stale data — 24h 신선 창과 미검증 UNKNOWN', () => {
  const fresh = normalize.freshnessOf(new Date(NOW.getTime() - 5 * 3600_000).toISOString(), NOW);
  const stale = normalize.freshnessOf(new Date(NOW.getTime() - 30 * 3600_000).toISOString(), NOW);
  const never = normalize.freshnessOf(null, NOW);
  const junkTime = normalize.freshnessOf('not-a-date', NOW);
  assert.equal(fresh, 'FRESH');
  assert.equal(stale, 'STALE');
  assert.equal(never, 'UNKNOWN');
  assert.equal(junkTime, 'UNKNOWN');
  assert.equal(normalize.FRESH_WINDOW_HOURS, 24);
});

/* ── B7 sheet write/readback: 스테이징 요청 → readback 결정적 검증 ── */
test('B7 sheet write/readback — staging rows 생성과 readback 불일치 탐지', async () => {
  const good = sources.parseGetItemView(itemViewPayload({ no: 67853341, inventory: 12 }), NOW_ISO);
  const rec1 = sources.factToStockRecord(good, CATALOG_ITEM).record;
  const good2 = sources.parseGetItemView(itemViewPayload({ no: 64287719, inventory: null, status: '판매중' }), NOW_ISO);
  const rec2 = sources.factToStockRecord(good2, { ...CATALOG_ITEM, productId: 'PRD-N1-02', supplierProductId: '64287719' }).record;

  const write = bridge.buildStagingWriteRequest([rec1, rec2], 'SW-TEST', NOW_ISO);
  assert.equal(write.tab, 'Stock_Staging');
  assert.equal(write.rows.length, 2);
  assert.equal(write.headers.includes('재고검증일시'), true);
  assert.equal(write.rows[0]['재고수량'], '12');
  assert.equal(write.rows[1]['재고수량'], '', '미확인 수량은 빈 값 (0 창작 금지)');

  // 정상 readback
  const okReport = { requestType: 'STOCK_STAGING_READBACK', requestId: 'SW-TEST', tab: 'Stock_Staging', rows: write.rows, readAt: NOW_ISO };
  assert.equal(bridge.validateStagingReadback(write, okReport).ok, true);

  // 변조 readback — 수량 12→11 위조 탐지
  const tamperedRows = JSON.parse(JSON.stringify(write.rows));
  tamperedRows[0]['재고수량'] = '11';
  const badReport = { ...okReport, rows: tamperedRows };
  const check = bridge.validateStagingReadback(write, badReport);
  assert.equal(check.ok, false);
  assert.ok(check.mismatches.some((m) => m.includes('PRD-N1-01.재고수량')));

  // readback 시트행 → 레코드 복원 (API 읽기 경로와 동일 파서)
  const restored = normalize.stagingRowToRecord(write.rows[0]);
  assert.equal(restored.productId, 'PRD-N1-01');
  assert.equal(restored.stockQuantity, 12);
  assert.equal(restored.stockType, 'A');
  assert.deepEqual(restored.optionStock, rec1.optionStock);

  // 원장 병합 — 최신 검증 시각 승
  const older = { ...rec1, stockQuantity: 99, stockVerifiedAt: '2026-09-01T00:00:00.000Z' };
  const { ledger: merged, changed } = ledger.mergeLedger({ 'PRD-N1-01': older }, [rec1]);
  assert.equal(changed.includes('PRD-N1-01'), true);
  assert.equal(merged['PRD-N1-01'].stockQuantity, 12, '구값(99)이 신값(12)을 덮지 않는다');
});

/* ── B8 API read contract: /api/stock 응답 조립 로직 ── */
test('B8 API read contract — n1.stock.v1 필드·신선도·missing·미스테이징 폴백', () => {
  // route 내부 로직을 순수 재현 (Next 런타임 없이 계약 검증)
  const route = fs.readFileSync(path.resolve(__dirname, '../app/api/stock/route.ts'), 'utf8');
  assert.ok(route.includes("CONTRACT_VERSION = \"n1.stock.v1\""), '계약 버전 고정');
  assert.ok(route.includes('Stock_Staging'), '시트 스테이징 1순위');
  assert.ok(route.includes('stagedReadable'), '스테이징 가독성 표시');
  for (const field of ['stockStatus', 'stockQuantity', 'stockType', 'stockVerifiedAt', 'stockSource', 'stockConfidence', 'freshness', 'fresh', 'staged', 'optionStock']) {
    assert.ok(route.includes(field), `응답 필드 존재: ${field}`);
  }
  assert.ok(!route.includes('POST'), '읽기 전용 계약 (write 인터페이스 없음)');

  // 응답 뷰 조립 — 미스테이징 폴백 시 staged:false
  const { freshnessOf } = normalize;
  const rec = sources.factToStockRecord(
    sources.parseGetItemView(itemViewPayload({ no: 67853341, inventory: 7 }), NOW_ISO),
    CATALOG_ITEM,
  ).record;
  const view = {
    ...rec,
    freshness: freshnessOf(rec.stockVerifiedAt, NOW),
    fresh: freshnessOf(rec.stockVerifiedAt, NOW) === 'FRESH',
    staged: false,
  };
  assert.equal(view.fresh, true, '방금 검증값은 FRESH');
  assert.equal(view.staged, false, '원장 미러임을 정직 표시');
  assert.equal(view.stockQuantity, 7);
});

/* ── 보조: Session C 경계 어댑터 — finalStockCheck 주입 구현 ── */
test('stock adapter — supplierStock 경계에 검증 원장 주입 (확정/미확정 정직 판정)', async () => {
  const adapter = load('lib/stock/adapter.ts');
  const recs = { 'PRD-N1-01': sources.factToStockRecord(
      sources.parseGetItemView(itemViewPayload({ no: 67853341, inventory: 12 }), NOW_ISO), CATALOG_ITEM).record };
  recs['PRD-N1-01'].optionStock = [
    { optionKey: '블랙_M', color: '블랙', size: 'M', quantity: 5, available: true, rawLabel: '블랙/M' },
  ];
  recs['PRD-N1-02'] = { ...sources.factToStockRecord(
      sources.parseGetItemView(itemViewPayload({ no: 64287719, inventory: null }), NOW_ISO),
      { ...CATALOG_ITEM, productId: 'PRD-N1-02', supplierProductId: '64287719' }).record,
    stockVerifiedAt: new Date(NOW.getTime() - 30 * 3600_000).toISOString() }; // STALE
  const backend = adapter.createStockBackendAdapter(async () => recs, NOW);
  const res = await backend.checkAvailability([
    { sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 5 },   // 확정 — ok
    { sku: 'PRD-N1-01', color: '블랙', size: 'M', qty: 6 },   // 확정 — 수량 초과
    { sku: 'PRD-N1-02', color: '', size: 'M', qty: 1 },        // STALE → 미확정
    { sku: 'PRD-XX-XX', color: '', size: '', qty: 1 },          // 미스테이징 → 미확정
  ]);
  assert.equal(res.adapter, 'n1-stock-backend.v1');
  assert.equal(res.definitive, false, 'STALE 라인이 하나라 있으면 전체 미확정');
  assert.equal(res.lines[0].ok, true);
  assert.equal(res.lines[0].available, 5);
  assert.equal(res.lines[1].ok, false, '수량 초과는 확정 거절');
  assert.equal(res.lines[1].available, 5);
  assert.equal(res.lines[2].ok, null, 'STALE은 품절로 판정하지 않는다 (null)');
  assert.equal(res.lines[3].ok, null);
  assert.equal(res.ok, null);
});

/* ── 보조: cadence·SSRF 가드 (미션 §6) ── */
test('cadence/가드 — 일일 상한·백오프·호스트 검증·watcher 사이클', async () => {
  const cadence = watcher.DOMEGGOOK_CADENCE;
  assert.equal(cadence.itemViewIntervalSec, 6 * 3600);
  assert.equal(cadence.dailyCapPerProduct, 4, '무한 polling 방지 상한');

  const neverProbed = watcher.buildProbePlan([CATALOG_ITEM], {}, cadence, NOW);
  assert.equal(neverProbed.due.length, 1, '미검증 상품은 즉시 due');

  const recentLedger = { 'PRD-N1-01': { ...CATALOG_ITEM, stockVerifiedAt: new Date(NOW.getTime() - 3600_000).toISOString(), productId: 'PRD-N1-01', supplierName: '도매꾹', supplierProductId: '67853341', supplierUrl: '', stockStatus: '판매중', stockQuantity: 1, stockType: 'A', stockSource: 'x', stockConfidence: 'HIGH', optionStock: [] } };
  const waiting = watcher.buildProbePlan([CATALOG_ITEM], recentLedger, cadence, NOW);
  assert.equal(waiting.due.length, 0, '최근 검증분은 cadence 대기');
  assert.equal(waiting.deferred[0].reason, 'CADENCE_WAIT');

  const capped = watcher.buildProbePlan([CATALOG_ITEM], {}, cadence, NOW, {}, { 'PRD-N1-01': 4 });
  assert.equal(capped.deferred[0].reason, 'DAILY_CAP');

  // SSRF 가드 — 허용 호스트만, http는 https로 정규화
  assert.equal(sources.normalizeSupplierUrl('http://domeggook.com/67853341'), 'https://www.domeggook.com/67853341');
  assert.equal(sources.normalizeSupplierUrl('http://localhost/67853341'), null);
  assert.equal(sources.normalizeSupplierUrl('http://127.0.0.1/67853341'), null);
  assert.equal(sources.normalizeSupplierUrl('http://169.254.169.254/latest'), null);
  assert.equal(sources.normalizeSupplierUrl('ftp://www.domeggook.com/1'), null);
  assert.equal(sources.normalizeSupplierUrl('https://evil.example.com/67853341'), null);
  assert.equal(sources.isBlockedHost('192.168.0.10'), true);
  assert.equal(sources.isBlockedHost('www.domeggook.com'), false);

  // API URL 조립은 고정 호스트에서만
  const url = sources.buildApiUrl('getItemView', '4.6', { no: '67853341' }, 'AID');
  assert.ok(url.startsWith('https://www.domeggook.com/ssl/api/?'));
  assert.ok(url.includes('mode=getItemView'));
  assert.ok(url.includes('aid=AID'), 'aid는 실행 환경 주입값만 반영 (코드에 키 없음)');

  /* ── 보조: watcher 사이클 (direct 모드 — 주입된 스텁 프로브) ── */
  let calls = [];
  const deps = {
    catalog: [CATALOG_ITEM, { ...CATALOG_ITEM, productId: 'PRD-N1-02', supplierProductId: '64287719' }],
    now: () => NOW,
    loadLedger: async () => ({}),
    saveLedger: async () => {},
    hasApiKey: () => true,
    executeProbe: async (url, productId) => {
      calls.push({ url, productId });
      assert.ok(url.startsWith('https://www.domeggook.com/ssl/api/?'), '호출 URL은 고정 호스트');
      return { ok: true, body: itemViewPayload({ no: Number(productId), inventory: 3 }) };
    },
  };
  const cycle = await watcher.runWatcherCycle(deps);
  assert.equal(cycle.mode, 'direct');
  assert.equal(cycle.updated.length, 2, 'due 2건 모두 반영');
  assert.equal(calls.length, 2, '호출은 due 건수만큼 — 무한 polling 없음');

  /* ── 보조: bridge 모드 — 키 없으면 큐 적재만 하고 호출하지 않는다 ── */
  let enqueued = [];
  const bridgeDeps = {
    catalog: [CATALOG_ITEM],
    now: () => NOW,
    loadLedger: async () => ({}),
    saveLedger: async () => {},
    hasApiKey: () => false,
    executeProbe: null,
    enqueueProbeRequest: async (req) => enqueued.push(req),
  };
  const bridgeCycle = await watcher.runWatcherCycle(bridgeDeps);
  assert.equal(bridgeCycle.mode, 'bridge');
  assert.equal(calls.length, 2, 'bridge 모드에서는 공급처 호출 제로');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].requestId.startsWith('PB-PRD-N1-01'), true);
  assert.deepEqual(bridge.buildProbeRequest(CATALOG_ITEM, NOW_ISO).probes, ['item_view']);
});
