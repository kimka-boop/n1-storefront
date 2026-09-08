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

test('fit guidance separates fact from preference and admits uncertainty without size claims', () => {
  const { fitGuidance } = load();
  const profile = { gender: '남성', size: '100', fit: 'C' };
  // 프로필 없으면 해석 없음
  assert.equal(fitGuidance({ name: '아무 옷', fitShape: 'SHIRT', sizeChart: '' }, null), null);
  const g1 = fitGuidance({ name: '코튼 셔츠', fitShape: 'SHIRT', sizeChart: '' }, profile);
  assert.equal(g1.fact.includes('셔츠'), true);
  assert.equal(g1.fact.includes('확인 중'), true);
  assert.equal(g1.preference.includes('오버핏'), true);
  assert.equal(g1.preference.includes('한 치수'), true); // 이너 C → +1
  assert.equal(g1.note.includes('어려워요'), true);
  // 수치표가 있으면 노트가 수치표로 안내 — 여전히 호수를 단정하지 않음
  const g2 = fitGuidance({ name: '코튼 셔츠', fitShape: 'SHIRT', sizeChart: '가슴 110 | 어깨 46' }, profile);
  assert.equal(g2.fact.includes('공개되어 있어요'), true);
  assert.equal(g2.note.includes('수치표'), true);
  // 근거 없는 정밀 숫자/점수 문구 금지
  const joined = [g1.fact, g1.preference, g1.note].join(' ');
  assert.equal(/%|점수|정확한 사이즈는|추천 사이즈는 \w+/i.test(joined), false);
});
