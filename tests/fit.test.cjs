const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const target = path.resolve(__dirname, '../lib/fit.ts');
const load = () => fs.existsSync(target) ? require(target) : {};

/* 실제 카탈로그 형태의 상품 예시 (products-before.json 기준) */
const READY_TOP = {
  name: '세미 오버핏 폴리 셔츠',
  category: '의류-상의',
  fitShape: 'SHIRT',
  stretch: '보통',
  sizeChart: '한국사이즈 단면(cm) — 95(XL): 어깨46·가슴50·총장68 / 100(2XL): 어깨48·가슴51.5·총장69 / 105(3XL): 어깨50·가슴53·총장71',
  sizeOptions: [],
  optionStock: { '검정_95': 3 },
  stockStatus: '판매중',
  modelInfo: '177cm/75kg 기준 2XL 착용',
};
const CTX_C_TOP = { v: 2, preferredFit: 'C', topSize: '100' };

const NO_BANNED = /%|AI |점수|적합합니다|추천 사이즈는|CONFIDENCE|PERFECT/i;

test('preference shift follows declared preference only (A=0, B=outer+1, C=outer+2/inner+1)', () => {
  const { preferenceShift } = load();
  assert.equal(typeof preferenceShift, 'function');
  assert.equal(preferenceShift('오버핏 라운드넥 울 블렌드 니트', 'A'), 0);
  assert.equal(preferenceShift('베이직 V넥 코튼 긴팔 티셔츠', 'B'), 0);
  assert.equal(preferenceShift('헤비 코튼 블루종 자켓', 'B'), 1);
  assert.equal(preferenceShift('헤비 코튼 블루종 자켓', 'C'), 2);
  assert.equal(preferenceShift('베이직 V넥 코튼 긴팔 티셔츠', 'C'), 1);
});

test('fit preset size stays inside real size options and never guesses', () => {
  const { fitPresetSize } = load();
  const opts = ['S', 'M', 'L', 'XL'];
  assert.equal(fitPresetSize('아무 티셔츠', '100(L)', 'A', opts), 'L');
  assert.equal(fitPresetSize('블루종 자켓', '100(L)', 'B', opts), 'XL');   // 겉옷 +1
  assert.equal(fitPresetSize('블루종 자켓', '100(L)', 'C', opts), '');      // 2XL 없음 → 추측하지 않는다
  assert.equal(fitPresetSize('티셔츠', 'FREE', 'C', opts), '');             // 환산 불가 → ''
  assert.equal(fitPresetSize('티셔츠', '100(L)', 'A', []), '');             // 옵션 없음 → ''
});

/* ── CASE 6: 완전한 핏 데이터 → READY ── */
test('CASE 6 — complete product data yields READY with all four result layers', () => {
  const { interpretFit } = load();
  const r = interpretFit(READY_TOP, CTX_C_TOP);
  assert.ok(r);
  assert.equal(r.evidence, 'READY');
  assert.ok(r.productFact.includes('셔츠'));
  assert.ok(r.productFact.includes('수치표'));
  assert.ok(r.yourContext.includes('오버핏 선호'));
  assert.ok(r.yourContext.includes('평소 상의 100'));
  assert.ok(r.interpretation.length > 0);
  assert.ok(r.limitation.length > 0);
  assert.equal(r.purchasable, true);
});

test('result never uses scores, percent, or AI display language (§3, §16)', () => {
  const { interpretFit } = load();
  const r = interpretFit(READY_TOP, CTX_C_TOP);
  const joined = [r.productFact, r.yourContext, r.interpretation, r.sizeHint || '', r.limitation].join(' ');
  assert.equal(NO_BANNED.test(joined), false);
});

/* ── CASE 1: 게스트 설정 → 결과 (4층 구성이 컨텍스트만으로 도출된다) ── */
test('CASE 1 — guest context alone produces a personal interpretation without any server call data', () => {
  const { interpretFit } = load();
  const guestCtx = { v: 2, preferredFit: 'B' };
  const r = interpretFit({ ...READY_TOP, sizeChart: '', stockStatus: '판매중' }, guestCtx);
  assert.ok(r);
  assert.ok(r.yourContext.includes('세미오버'));
  assert.ok(r.interpretation.includes('가까운 실루엣')); // 세미오버 상품 × 세미오버 선호
  assert.equal(r.evidence, 'PARTIAL'); // 평소 사이즈 없음
});

/* ── CASE 2: 상품 A → 상품 B → 컨텍스트 유지 (같은 컨텍스트로 다른 상품 재계산) ── */
test('CASE 2 — same context recalculates per product, stays usable across items', () => {
  const { interpretFit } = load();
  const looseTop = { ...READY_TOP, name: '루즈핏 맨투맨', fitShape: 'SWEATSHIRT' };
  const slimTop = { ...READY_TOP, name: '슬림핏 셔츠', fitShape: 'SHIRT' };
  const a = interpretFit(looseTop, CTX_C_TOP);
  const b = interpretFit(slimTop, CTX_C_TOP);
  assert.ok(a.interpretation.includes('가까운 실루엣'));   // 오버 선호 × 루즈 상품
  assert.ok(b.interpretation.includes('몸에 닿는'));       // 오버 선호 × 슬림 상품
  assert.notEqual(a.interpretation, b.interpretation);
});

/* ── CASE 4: 선호 핏 수정 → 결과 재계산 (상품은 세미오버(B) 실루엣) ── */
test('CASE 4 — changing preferred fit flips the interpretation on the same product', () => {
  const { interpretFit } = load();
  const asOver = interpretFit(READY_TOP, { ...CTX_C_TOP, preferredFit: 'C' });
  const asSlim = interpretFit(READY_TOP, { ...CTX_C_TOP, preferredFit: 'A' });
  assert.ok(asOver.interpretation.includes('몸에 닿는'));       // B 상품 × 오버 선호 → 닿는 방향
  assert.ok(asSlim.interpretation.includes('여유가 있는'));     // B 상품 × 정핏 선호 → 여유 방향
  assert.notEqual(asOver.interpretation, asSlim.interpretation);
});

/* ── CASE 5: 초기화 → 컨텍스트 제거 (fitContext.test.cjs와 정합) ── */
test('CASE 14 — absent user context means no personal interpretation at all', () => {
  const { interpretFit } = load();
  assert.equal(interpretFit(READY_TOP, null), null);
  assert.equal(interpretFit(READY_TOP, undefined), null);
  assert.equal(interpretFit(READY_TOP, { v: 2, preferredFit: '' }), null);
});

/* ── CASE 7: 수치표 없음 → 호수 확정 없음 ── */
test('CASE 7 — missing sizeChart caps evidence and never suggests a size row', () => {
  const { interpretFit } = load();
  const r = interpretFit({ ...READY_TOP, sizeChart: '' }, CTX_C_TOP);
  assert.equal(r.evidence, 'PARTIAL');
  assert.equal(r.sizeHint, undefined);
  assert.ok(r.limitation.includes('수치표가 아직'));
  // UNKNOWN 수치표도 없는 것과 같다
  const r2 = interpretFit({ ...READY_TOP, sizeChart: 'UNKNOWN (상세 크롤 후 보강)' }, CTX_C_TOP);
  assert.equal(r2.evidence, 'PARTIAL');
  assert.equal(r2.sizeHint, undefined);
});

/* ── CASE 8: 옵션 재고 없음 → 구매 가능 가정 없음 ── */
test('CASE 8 — missing optionStock means no purchasable framing', () => {
  const { interpretFit } = load();
  const r = interpretFit({ ...READY_TOP, optionStock: {} }, CTX_C_TOP);
  assert.equal(r.purchasable, false);
  const joined = `${r.interpretation} ${r.sizeHint || ''}`;
  assert.equal(/구매|살 수|재고 있/.test(joined), false);
});

/* ── CASE 9: 신축성 미확인 → 신축성 언급 없음 ── */
test('CASE 9 — unknown stretch is never mentioned, verified stretch may be', () => {
  const { interpretFit } = load();
  const unknown = interpretFit({ ...READY_TOP, stretch: '' }, CTX_C_TOP);
  assert.equal(unknown.productFact.includes('신축성'), false);
  const annotated = interpretFit({ ...READY_TOP, stretch: '없음 (니트 아님 — 원단 특성상 정보 없음)' }, CTX_C_TOP);
  assert.equal(annotated.productFact.includes('신축성'), false); // 공급사 주석 — 인용하지 않는다
  const known = interpretFit({ ...READY_TOP, stretch: '좋음' }, CTX_C_TOP);
  assert.equal(known.productFact.includes('신축성'), true);
});

/* ── CASE 10: AI 이미지뿐 — 측정 근거로 사용하지 않는다 ── */
test('CASE 10 — engine accepts no image input; AI images cannot alter the verdict', () => {
  const { interpretFit } = load();
  const base = interpretFit({ ...READY_TOP, sizeChart: '', modelInfo: '' }, CTX_C_TOP);
  const withAiImage = interpretFit(
    { ...READY_TOP, sizeChart: '', modelInfo: '', tryonImage: 'https://cdn.fashn.ai/example/product_to_model_0.jpeg' },
    CTX_C_TOP,
  );
  assert.deepEqual({ ...withAiImage }, { ...base }); // 이미지 계열 필드는 입력 계약 자체에 없다
  assert.equal(/이미지.*(실측|치수)|실측.*이미지/.test(base.productFact), false);
});

/* ── CASE 11: 상의/하의 규칙 분리 ── */
test('CASE 11 — tops and bottoms follow different rules and different usual sizes', () => {
  const { interpretFit, categoryOf } = load();
  const bottom = {
    name: '홀리데이 와이드 밴딩 슬랙스 와이드팬츠 정장 캐주얼 바지',
    category: '의류-하의',
    fitShape: 'SLACKS',
    sizeChart: 'SIZE 30(29-31인치): 허리단면 33, 엉덩이단면 53.5, 허벅지단면 31.5, 밑위 28, 총장 100 / SIZE 32(31-33인치): 허리단면 35, 엉덩이단면 55, 허벅지단면 32.5, 밑위 29, 총장 101',
    optionStock: { '블랙_30': 2 },
    stockStatus: '판매중',
  };
  const ctx = { v: 2, preferredFit: 'C', topSize: '100', bottomSize: '30~31' };
  assert.equal(categoryOf(bottom), 'bottom');
  const r = interpretFit(bottom, ctx);
  assert.ok(r.productFact.includes('허리'));
  assert.ok(r.yourContext.includes('평소 하의 30~31'));
  assert.equal(r.yourContext.includes('상의'), false);
  assert.equal(r.evidence, 'READY'); // 와이드(실루엣) + 실측표 + 평소 하의 사이즈
  assert.ok(r.productFact.includes('실측'));
  // 상의는 상의 사이즈를 쓴다
  const rTop = interpretFit(READY_TOP, ctx);
  assert.ok(rTop.yourContext.includes('평소 상의 100'));
});

/* ── CASE 12: 품절 → 구매 제안 아님 ── */
test('CASE 12 — sold-out product keeps interpretation but never frames it as buyable', () => {
  const { interpretFit } = load();
  const r = interpretFit({ ...READY_TOP, stockStatus: '품절' }, CTX_C_TOP);
  assert.equal(r.purchasable, false);
  assert.ok(r.limitation.includes('품절'));
  assert.equal(r.sizeHint, undefined); // 사이즈 행 안내도 구매 제안처럼 읽히지 않게 억제
});

/* ── CASE 13: 모순 데이터 → 안전한 한계 ── */
test('CASE 13 — contradictory fit words in the name refuse to commit to a silhouette', () => {
  const { interpretFit, silhouetteOf } = load();
  assert.equal(silhouetteOf('세미와이드팬츠 세미와이드 밴딩'), 'B');  // 와이드 부분문자 오판 금지
  assert.equal(silhouetteOf('일자 세미 와이드핏 데님 팬츠'), 'B');
  assert.equal(silhouetteOf('루즈핏 맨투맨'), 'C');
  assert.equal(silhouetteOf('슬림핏 조거팬츠'), 'A');
  assert.equal(silhouetteOf('와이드 슬림 혼합 표기 셔츠'), 'mixed');
  const r = interpretFit({ ...READY_TOP, name: '와이드 슬림 혼합 표기 셔츠' }, CTX_C_TOP);
  assert.notEqual(r.evidence, 'READY');
  assert.ok(r.interpretation.includes('단정하지 않'));
  assert.ok(r.limitation.includes('섞여'));
});

test('miscategorized accessory (모자) is honestly UNAVAILABLE, never fit-interpreted', () => {
  const { interpretFit, categoryOf } = load();
  const hat = { name: '모자 남여공용 데님버킷 BB083', category: '의류-하의', optionStock: { 'FREE': 1 }, stockStatus: '판매중' };
  assert.equal(categoryOf(hat), 'accessory');
  const r = interpretFit(hat, CTX_C_TOP);
  assert.equal(r.evidence, 'UNAVAILABLE');
  assert.equal(/호수|사이즈를 추천|추천/.test(r.interpretation), false);
});

test('unconfirmed product (garment only, no silhouette words, no chart) says so honestly (§28)', () => {
  const { interpretFit } = load();
  const r = interpretFit({
    name: '남자 골프티 긴팔 카라티셔츠 무지 카라티',
    category: '의류-상의',
    fitShape: 'TSHIRT',
    sizeChart: 'UNKNOWN (상세 크롤 후 보강)',
    stockStatus: '판매중',
  }, CTX_C_TOP);
  assert.equal(r.evidence, 'UNCONFIRMED');
  assert.ok(r.interpretation.includes('확인 중'));
  assert.equal(r.sizeHint, undefined);
});

test('chart anchor matching is word-boundary exact (L must not match XL)', () => {
  const { chartInfo, anchorInChart } = load();
  const chart = chartInfo('XL(32): 허리단면 34 / 2XL(34): 허리단면 36', 'bottom');
  assert.equal(anchorInChart(chart, 'L'), '');
  const topChart = chartInfo('95(XL): 어깨46·가슴50 / 100(2XL): 어깨48·가슴51 / 105(3XL): 어깨50', 'top');
  assert.equal(anchorInChart(topChart, '100'), '100(2XL)');
  assert.equal(anchorInChart(topChart, '100(L)'), '100(2XL)');
  const inch = chartInfo('SIZE 30(29-31인치): 허리단면 33 / SIZE 32(31-33인치): 허리단면 35', 'bottom');
  assert.equal(anchorInChart(inch, '30~31'), 'SIZE 30(29-31인치)');
});

test('one-size (FREE) products surface the fact without size gymnastics', () => {
  const { interpretFit } = load();
  const r = interpretFit({
    name: '겨울 니트 골지 와이드팬츠 따뜻한 밴딩 바지 크림',
    category: '의류-하의',
    fitShape: 'SWEATPANTS',
    sizeChart: 'FREE: 허리단면 32cm, 총길이 99cm (단위 cm)',
    stockStatus: '판매중',
  }, { v: 2, preferredFit: 'C', bottomSize: '30~31' });
  assert.ok(r.productFact.includes('원사이즈'));
  assert.ok(r.evidence === 'READY' || r.evidence === 'PARTIAL');
});
