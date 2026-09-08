const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const target = path.resolve(__dirname, '../lib/fitContext.ts');
const load = () => fs.existsSync(target) ? require(target) : {};

/** localStorage 계약을 흉내 내는 메모리 스토리지 (테스트 격리용) */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const GUEST_CTX = { v: 2, preferredFit: 'C', topSize: '100', bottomSize: '30~31' };

/* ── CASE 2: 게스트 → 상품 A → 상품 B → 컨텍스트 유지 ── */
test('CASE 2 — saved context round-trips through storage across simulated navigations', () => {
  const { saveFitContext, loadFitContext } = load();
  const storage = fakeStorage();
  saveFitContext(GUEST_CTX, storage);
  // 상품 A 방문 → 로드 → 같은 컨텍스트
  assert.deepEqual(loadFitContext(storage), GUEST_CTX);
  // 상품 B 방문 → 다시 로드 → 여전히 같은 컨텍스트 (질문 반복 없음)
  assert.deepEqual(loadFitContext(storage), GUEST_CTX);
});

test('v1 profiles migrate to v2 without losing the guest\'s answers', () => {
  const { migrateFitContext } = load();
  assert.deepEqual(
    migrateFitContext({ gender: '남성', size: '100', fit: 'C' }),
    { v: 2, preferredFit: 'C', topSize: '100', gender: '남성' },
  );
  assert.equal(migrateFitContext({ gender: '남성', size: '100' }), null); // fit 없음 → 판별 불가
  assert.equal(migrateFitContext('garbage'), null);
  assert.equal(migrateFitContext(null), null);
});

/* ── CASE 3: 게스트 → 스마트 핏 → 로그인 → 같은 컨텍스트 생존 ── */
test('CASE 3 — login with an empty account memory keeps the guest context and promotes it', () => {
  const { mergeOnLogin } = load();
  const r = mergeOnLogin(null, GUEST_CTX);
  assert.deepEqual(r.ctx, GUEST_CTX);
  assert.equal(r.syncToServer, true); // 계정에 승격되어 다음 기기에서도 이어진다
  const r2 = mergeOnLogin({ gender: '미지정', size: '', fit: '' }, GUEST_CTX);
  assert.deepEqual(r2.ctx, GUEST_CTX);
  assert.equal(r2.syncToServer, true);
});

test('login with an existing account memory adopts the server profile (multi-device truth)', () => {
  const { mergeOnLogin } = load();
  const server = { gender: '미지정', size: '상의 95 · 하의 28~29', fit: 'A' };
  const r = mergeOnLogin(server, GUEST_CTX);
  assert.equal(r.ctx.preferredFit, 'A');
  assert.equal(r.ctx.topSize, '95');
  assert.equal(r.ctx.bottomSize, '28~29');
  assert.equal(r.syncToServer, false); // 서버가 이겼으니 올릴 것 없다
});

/* ── CASE 15: 로그인 실패/취소 → 게스트 컨텍스트 유지 ── */
test('CASE 15 — failed or cancelled login never touches stored context', () => {
  const { saveFitContext, loadFitContext } = load();
  const storage = fakeStorage();
  saveFitContext(GUEST_CTX, storage);
  // 로그인 실패 = mergeOnLogin이 호출되지 않는다 — 저장소는 그대로
  assert.deepEqual(loadFitContext(storage), GUEST_CTX);
});

/* ── CASE 5: 초기화 → 컨텍스트 제거 ── */
test('CASE 5 — reset removes stored context so nothing hidden persists (§27)', () => {
  const { saveFitContext, loadFitContext, clearFitContext } = load();
  const storage = fakeStorage();
  saveFitContext(GUEST_CTX, storage);
  clearFitContext(storage);
  assert.equal(loadFitContext(storage), null);
});

test('server codec keeps the /api/auth contract and round-trips both sizes', () => {
  const { encodeProfileForServer, parseServerProfile } = load();
  const wire = encodeProfileForServer(GUEST_CTX);
  // 기존 Users 시트 계약 {gender, size, fit} 유지 — 성별 미수집은 '미지정'으로 정직하게
  assert.deepEqual(wire, { gender: '미지정', size: '상의 100 · 하의 30~31', fit: 'C' });
  const back = parseServerProfile(wire);
  assert.equal(back.preferredFit, 'C');
  assert.equal(back.topSize, '100');
  assert.equal(back.bottomSize, '30~31');
  assert.equal(back.gender, undefined); // '미지정'은 사용자 데이터가 아니므로 보존하지 않는다
});

test('legacy single-size server profiles load as top anchors', () => {
  const { parseServerProfile } = load();
  const ctx = parseServerProfile({ gender: '남성', size: '100', fit: 'B' });
  assert.equal(ctx.preferredFit, 'B');
  assert.equal(ctx.topSize, '100');
  assert.equal(ctx.bottomSize, undefined);
});

test('context remains usable with fit preference alone (progressive input, §7)', () => {
  const { isFitContextUsable, migrateFitContext } = load();
  assert.equal(isFitContextUsable({ v: 2, preferredFit: 'B' }), true);
  assert.equal(isFitContextUsable(null), false);
  assert.equal(isFitContextUsable(migrateFitContext({ fit: 'nope' })), false);
});
