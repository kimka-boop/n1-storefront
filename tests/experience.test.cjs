const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const target = path.resolve(__dirname, '../lib/experience.ts');
const load = () => fs.existsSync(target) ? require(target) : {};

test('collection shows every product by exact gender and searches within the edit', () => {
  const { selectCollection } = load();
  assert.equal(typeof selectCollection, 'function', 'collection selector must exist');
  const rows = [
    { id:'a', name:'울 니트', gender:'FEMALE', lookbookStatus:'생성완료', lookbookImage:'https://example.test/a.png' },
    { id:'b', name:'셔츠', gender:'MALE', lookbookStatus:'생성완료', lookbookImage:'https://example.test/b.png' },
    { id:'c', name:'미완성 니트', gender:'FEMALE', lookbookStatus:'대기', lookbookImage:'' },
  ];
  // 2026-09-08 Owner 지시: 룩북 미생성('대기') 상품도 컬렉션에서 제외하지 않는다(남20/여20/젠더리스20 전체 전시)
  assert.deepEqual(selectCollection(rows, 'FEMALE', '니트').map(p=>p.id), ['a','c']);
  assert.equal(selectCollection(rows, 'MALE', '니트').length, 0);
  assert.equal(selectCollection(rows, 'all', '').length, 3);
});

test('purchase readiness rejects unknown variants and carries raw color through the handoff', () => {
  const { purchaseState, quickBuyUrl } = load();
  assert.equal(typeof purchaseState, 'function');
  const p = { id:'PRD-X', stockStatus:'판매중', colorOptions:['겨자 / 네이비'], sizeOptions:['M','L'], optionStock:{'겨자_M':2,'겨자_L':0,'네이비_M':4} };
  assert.equal(purchaseState({...p,optionStock:{}},'겨자','M'), 'unconfirmed');
  assert.equal(purchaseState(p,'겨자','M'), 'ready');
  assert.equal(purchaseState(p,'겨자','L'), 'soldout');
  assert.equal(purchaseState(p,'네이비','L'), 'unconfirmed');
  assert.equal(purchaseState(p,'겨자',''), 'choose');
  assert.equal(purchaseState({...p,stockStatus:'품절'},'겨자','M'), 'soldout');
  const url = new URL(quickBuyUrl(p.id,'겨자','M'),'https://example.test');
  assert.equal(url.searchParams.get('color'),'겨자');
  assert.equal(url.searchParams.get('size'),'M');
});

test('color display splits lists but preserves two-tone values and raw order keys', () => {
  const { productColors } = load();
  assert.equal(typeof productColors, 'function');
  assert.deepEqual(productColors(['겨자 / 오렌지 / 네이비']), [
    {value:'겨자', label:'머스타드'}, {value:'오렌지', label:'오렌지'}, {value:'네이비', label:'네이비'}
  ]);
  assert.deepEqual(productColors(['카키/블랙 · 크레이&와인']).map(x=>x.value), ['카키/블랙','크레이&와인']);
  assert.deepEqual(productColors(['UNKNOWN (상세 이미지 참조)']), []);
});
