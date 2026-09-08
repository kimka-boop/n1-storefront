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

/* ══════════════════════════════════════════════════════════════════
   SESSION A — SMART FIT DATA FOUNDATION (A5·A6·A7·A8-클라이언트·A9-클라이언트)
   저장소 경계: 게스트 = sessionStorage, 회원 = localStorage + 서버(§6·§7·§8)
   ══════════════════════════════════════════════════════════════════ */

function fakeSession() { return fakeStorage(); } // sessionStorage 계약 (getItem/setItem/removeItem)
function fakeLocal() { return fakeStorage(); }  // localStorage 계약

/* ── A5: 게스트 핏은 탭 세션 안에서 유지된다 — PDP 이동·새로고침·카트 이동 ── */
test('A5 — guest fit persists across simulated PDP navigation/reload within one tab session', () => {
  const { saveGuestFitContext, loadGuestFitContext } = load();
  const session = fakeSession();
  // 홈에서 스마트 핏 답변 → sessionStorage에 저장
  saveGuestFitContext(GUEST_CTX, session);
  // PDP 이동(컴포넌트 리마운트 = 다시 로드) — 같은 값
  assert.deepEqual(loadGuestFitContext(session), GUEST_CTX);
  // 새로고침(다시 로드) — 같은 값
  assert.deepEqual(loadGuestFitContext(session), GUEST_CTX);
  // 카트 이동(또 다시 로드) — 같은 값
  assert.deepEqual(loadGuestFitContext(session), GUEST_CTX);
});

/* ── A5b: 탭이 닫히면(새 세션) 게스트 핏은 사라진다 ── */
test('A5b — a new tab session starts with no guest fit (session-bound, not persistent)', () => {
  const { saveGuestFitContext, loadGuestFitContext } = load();
  const oldTab = fakeSession();
  saveGuestFitContext(GUEST_CTX, oldTab);
  const newTab = fakeSession(); // 닫힌 탭의 sessionStorage는 새 탭으로 이어지지 않는다
  assert.equal(loadGuestFitContext(newTab), null);
});

/* ── A6: 게스트 핏은 localStorage·Customer Sheet 어디에도 쓰지 않는다 ── */
test('A6 — guest fit goes to sessionStorage only, never to persistent storage', () => {
  const { saveGuestFitContext, loadMemberFitContext, loadGuestFitContext } = load();
  const session = fakeSession();
  const local = fakeLocal();
  saveGuestFitContext(GUEST_CTX, session);
  // localStorage에는 아무것도 없다
  assert.equal(loadMemberFitContext(local), null, '회원 기기 슬롯도 건드리지 않는다');
  // 세션에는 있다
  assert.deepEqual(loadGuestFitContext(session), GUEST_CTX);
  // "Sheet에 없다"의 코드측 보장: 게스트 저장 경로는 서버를 호출하지 않는다 —
  // AuthProvider.saveFit이 token 없으면 sessionStorage에만 쓴다(컴포넌트 테스트는
  // 브라우저 QA, 서버 401은 authFoundation A6-server가 검증).
});

/* ── A7: 게스트 → 회원 승격 — 세션 사본이 기기 슬롯으로 옮겨지고 사본은 지워진다 ── */
test('A7 — promotion moves guest session copy into the member slot and clears the session copy', () => {
  const { saveGuestFitContext, promoteGuestFitToMember, loadGuestFitContext, loadMemberFitContext } = load();
  const session = fakeSession();
  const local = fakeLocal();
  saveGuestFitContext(GUEST_CTX, session);
  const promoted = promoteGuestFitToMember(GUEST_CTX, session, local);
  assert.deepEqual(promoted, GUEST_CTX);
  // 회원 슬롯에 저장되어 다음 방문(같은 탭이 아니어도) 회원으로 복원된다
  assert.deepEqual(loadMemberFitContext(local), GUEST_CTX);
  // 게스트 임시 사본은 정리된다 — 남은 잔존 금지(§8)
  assert.equal(loadGuestFitContext(session), null);
});

/* ── A7b: 승격은 서버 동기화 필요 여부를 그대로 유지한다(계정에 저장 → readback) ── */
test('A7b — a promoted guest context still encodes for the server without re-asking', () => {
  const { promoteGuestFitToMember, saveGuestFitContext, encodeProfileForServer, mergeOnLogin } = load();
  const session = fakeSession();
  const local = fakeLocal();
  saveGuestFitContext(GUEST_CTX, session);
  const promoted = promoteGuestFitToMember(GUEST_CTX, session, local);
  const wire = encodeProfileForServer(promoted);
  assert.deepEqual(wire, { gender: '미지정', size: '상의 100 · 하의 30~31', fit: 'C' });
  // 회원가입 응답의 profile(서버에 저장된 값)과 병합 — 서버가 비어 있으므로 승격 유지
  const merged = mergeOnLogin({ gender: '미지정', size: '', fit: '' }, promoted);
  assert.deepEqual(merged.ctx, GUEST_CTX);
  assert.equal(merged.syncToServer, true, '서버 저장 + readback 경로가 열린다');
  // Smart Fit을 다시 묻지 않는다 — 승격된 ctx로 initialFlowState가 result에서 시작한다
  const flow = require(path.resolve(__dirname, '../lib/fitFlow.ts'));
  const st = flow.initialFlowState(promoted, null);
  assert.equal(st.step, 'result');
});

/* ── A8: 회원 핏 복원 — 계정 기억이 기기 슬롯에서(그리고 서버에서) 돌아온다 ── */
test('A8 — member fit restores from the device slot and wins through server merge', () => {
  const { saveMemberFitContext, loadMemberFitContext, mergeOnLogin } = load();
  const local = fakeLocal();
  saveMemberFitContext(GUEST_CTX, local); // 회원이 저장해 둔 상태
  // 같은 브라우저 재방문 — 기기 슬롯에서 복원
  assert.deepEqual(loadMemberFitContext(local), GUEST_CTX);
  // 다른 기기에서 저장된 서버 프로필 — 서버가 이긴다(계정 기억)
  const serverWire = { gender: '미지정', size: '상의 95 · 하의 28~29', fit: 'A' };
  const merged = mergeOnLogin(serverWire, loadMemberFitContext(local));
  assert.equal(merged.ctx.preferredFit, 'A');
  assert.equal(merged.syncToServer, false);
});

/* ── A9: edit/reset — 회원의 기기+서버 양쪽 정리 경로가 준비되어 있다 ── */
test('A9 — edit updates the slot; reset clears both storages and flags the server reset', () => {
  const {
    saveMemberFitContext, saveGuestFitContext, clearFitContext,
    loadMemberFitContext, loadGuestFitContext, RESET_FIT_PROFILE_FLAG,
  } = load();
  const local = fakeLocal();
  const session = fakeSession();
  // edit — 값을 바꿔 저장하면 슬롯이 새 값이 된다
  saveMemberFitContext({ v: 2, preferredFit: 'A', topSize: '95' }, local);
  assert.equal(loadMemberFitContext(local).preferredFit, 'A');
  saveMemberFitContext({ v: 2, preferredFit: 'C', topSize: '105', bottomSize: '32~33' }, local);
  const edited = loadMemberFitContext(local);
  assert.equal(edited.preferredFit, 'C');
  assert.equal(edited.bottomSize, '32~33');
  // reset — 두 저장소 모두에서 지워진다(숨은 잔존 금지, §9)
  saveGuestFitContext(GUEST_CTX, session);
  clearFitContext(local);
  clearFitContext(session);
  assert.equal(loadMemberFitContext(local), null);
  assert.equal(loadGuestFitContext(session), null);
  // 서버 초기화 플래그 계약 — AuthProvider가 action profile + 이 플래그로 보낸다
  assert.equal(RESET_FIT_PROFILE_FLAG, 'resetFitProfile');
});

/* ── A8b: 서버가 이긴 로그인 — 기기 슬롯은 서버 값으로 묶이고 세션 사본은 지워진다 ── */
test('A8b — when the server profile wins, the device slot takes the server value, not the stale session copy', () => {
  const { saveGuestFitContext, promoteGuestFitToMember, loadGuestFitContext, loadMemberFitContext } = load();
  const session = fakeSession();
  const local = fakeLocal();
  // 게스트 세션에는 C 취향이, 서버(다른 기기)에는 A 프로필이 있다
  saveGuestFitContext({ v: 2, preferredFit: 'C', topSize: '110' }, session);
  const serverCtx = { v: 2, preferredFit: 'A', topSize: '95', bottomSize: '28~29' };
  // mergeOnLogin이 서버 값을 고른 뒤 그 값으로 승격한다 — 세션 사본으로 슬롯을 덮지 않는다
  const promoted = promoteGuestFitToMember(serverCtx, session, local);
  assert.deepEqual(promoted, serverCtx);
  assert.deepEqual(loadMemberFitContext(local), serverCtx, '기기 슬롯은 서버 값이다');
  assert.equal(loadGuestFitContext(session), null, '게스트 사본은 정리된다');
});
