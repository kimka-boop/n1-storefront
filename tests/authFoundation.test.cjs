/**
 * SESSION A — AUTH FOUNDATION TESTS (A1–A4, A6-서버, A8-서버, A9-서버)
 *
 * lib/authServer.ts를 실제 TypeScript로 실행해 검증한다. 영구 저장소(Google
 * Sheets)는 스파이로 주입한다 — Sheet lookup만으로 유일성을 보장하지 않는다는
 * 설계(lib/authServer.AuthStore 예약 인덱스)를 그대로 시험한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  module._compile(code, filename);
};
const path = require('node:path');
const authServer = require(path.resolve(__dirname, '../lib/authServer.ts'));
const username = require(path.resolve(__dirname, '../lib/username.ts'));

/** 스파이 영구 저장소 — create/exists/updateProfile 호출을 기록한다. */
function fakePersistence() {
  const rows = [];
  return {
    rows,
    created: [],
    updated: [],
    resets: 0,
    async exists(un, em) { return rows.some((r) => r.username === un || r.email === em); },
    async create(a) { rows.push({ ...a }); this.created.push(a.username); },
    async updateHash(email, hash) {
      const r = rows.find((x) => x.email === email);
      if (r) r.hash = hash;
    },
    async updateProfile(email, profile) {
      const r = rows.find((x) => x.email === email);
      if (!profile) { this.resets++; if (r) { r.profile = { gender: '미지정', size: '', fit: '' }; } return; }
      this.updated.push(email);
      if (r) r.profile = profile;
    },
  };
}

const WIRE = { gender: '미지정', size: '상의 100 · 하의 30~31', fit: 'C' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── A1: 고유한 아이디는 각각 가입에 성공한다 ── */
test('A1 — unique usernames each register successfully', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const a = await store.register({ username: 'Mina_K', email: 'mina@example.com', password: 'secret1', profile: WIRE });
  const b = await store.register({ username: 'jinho', email: 'jinho@example.com', password: 'secret2', profile: WIRE });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(p.created.length, 2);
  // 정규화: 대문자·공백 입력도 같은 정규형으로 저장된다
  const c = await store.register({ username: '  HANA  ', email: 'hana@example.com', password: 'secret3', profile: WIRE });
  assert.equal(c.ok, true);
  assert.equal(c.account.username, 'hana');
});

/* ── A2: 같은 아이디 재가입은 거절된다 (대소문자·공백 정규형 기준) ── */
test('A2 — duplicate username is rejected, including normalized variants', async () => {
  const store = new authServer.AuthStore(fakePersistence());
  const first = await store.register({ username: 'mina_k', email: 'mina@example.com', password: 'secret1', profile: WIRE });
  assert.equal(first.ok, true);
  const dup = await store.register({ username: 'mina_k', email: 'other@example.com', password: 'secret2', profile: WIRE });
  assert.equal(dup.ok, false);
  assert.equal(dup.status, 409);
  const dupCase = await store.register({ username: 'MINA_K', email: 'another@example.com', password: 'secret2', profile: WIRE });
  assert.equal(dupCase.ok, false, '정규화(소문자) 기준으로도 같은 아이디다');
  const dupEmail = await store.register({ username: 'other_user', email: 'MINA@example.com', password: 'secret2', profile: WIRE });
  assert.equal(dupEmail.ok, false, '이메일도 정규형 기준으로 유일하다');
});

/* ── A3: 같은 아이디 동시 가입 경쟁 — 정확히 하나만 통과 ── */
test('A3 — concurrent registration of the same username lets exactly one win', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const attempts = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'].map((email) =>
    store.register({ username: 'race_id', email, password: 'secret1', profile: WIRE })
  );
  const results = await Promise.all(attempts);
  const wins = results.filter((r) => r.ok);
  assert.equal(wins.length, 1, `승자는 정확히 1개여야 한다 — 실제 ${wins.length}`);
  assert.equal(results.filter((r) => !r.ok && r.status === 409).length, 4);
  assert.equal(p.created.length, 1, '영구 저장소에도 한 번만 기록된다');
});

/* ── A3 보조: 영구 저장 실패 시 예약이 풀려 다시 가입할 수 있다 ── */
test('A3b — a failed persistent write releases the reservation honestly', async () => {
  let failFirst = true;
  const store = new authServer.AuthStore({
    async exists() { return false; },
    async create() { if (failFirst) { failFirst = false; throw new Error('sheet down'); } },
  });
  const first = await store.register({ username: 'retry_id', email: 'r1@x.com', password: 'secret1', profile: WIRE });
  assert.equal(first.ok, false, '저장 실패는 정직하게 실패를 반환한다');
  const second = await store.register({ username: 'retry_id', email: 'r2@x.com', password: 'secret1', profile: WIRE });
  assert.equal(second.ok, true, '예약 해제 후 같은 아이디로 가입 가능');
});

/* ── A4: 이메일 문법 검증 ── */
test('A4 — invalid email syntax is rejected, valid email is normalized', async () => {
  const store = new authServer.AuthStore(fakePersistence());
  for (const bad of ['not-an-email', 'a@b', 'spaces in@x.com', '@nope.com', '']) {
    const r = await store.register({ username: `user_${bad.length}_${bad.replace(/[^a-z0-9]/g, '') || 'x'}`, email: bad, password: 'secret1', profile: WIRE });
    assert.equal(r.ok, false, `'${bad}'은 거부되어야 한다`);
    assert.equal(r.status, 400);
  }
  const ok = await store.register({ username: 'valid_id', email: '  USER@Example.COM ', password: 'secret1', profile: WIRE });
  assert.equal(ok.ok, true);
  assert.equal(ok.account.email, 'user@example.com', '이메일은 trim+소문자 정규형으로 저장된다');
  // validateEmail 단위
  assert.equal(authServer.validateEmail('ok@domain.co').ok, true);
  assert.equal(authServer.validateEmail('no-tld@domain').ok, false);
});

/* ── A1 보조: check-username 가용성 판정 (결정적, AI 없음) ── */
test('A1b — username availability check is deterministic server-side', async () => {
  const store = new authServer.AuthStore(fakePersistence());
  assert.deepEqual(store.usernameAvailable('good_id'), { available: true });
  assert.equal(store.usernameAvailable('good_id').available, true);
  assert.equal(store.usernameAvailable('Bad Id!').available, false, '문법 위반은 unavailable');
  assert.equal(store.usernameAvailable('ab').available, false, '너무 짧다');
  await store.register({ username: 'taken_one', email: 't@x.com', password: 'secret1', profile: WIRE });
  assert.equal(store.usernameAvailable('TAKEN_ONE').available, false, '정규형 기준 중복');
});

/* ── §2: 비밀번호 — 평문 저장 없음 + scrypt + 레거시 승격 ── */
test('A2b — passwords are stored as scrypt hashes; legacy rows upgrade on login', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const reg = await store.register({ username: 'hash_user', email: 'h@x.com', password: 'plaintext-pw', profile: WIRE });
  assert.equal(reg.ok, true);
  const stored = p.rows[0].hash;
  assert.match(stored, /^s1\$/, '현행 해시 포맷 s1$이다');
  assert.ok(!stored.includes('plaintext-pw'), '평문이 해시 문자열에 없다');
  assert.notEqual(stored, authServer.legacyHash('plaintext-pw'), '구버전 약해시를 그대로 저장하지 않는다');
  // 동일 평문이라도 salt 때문에 해시가 매번 다르다
  const reg2 = await store.register({ username: 'hash_user2', email: 'h2@x.com', password: 'plaintext-pw', profile: WIRE });
  assert.notEqual(p.rows[1].hash, stored, '같은 평문이라도 저장된 해시는 다르다(랜덤 salt)');
  assert.equal(reg2.ok, true);

  // 레거시 행 로그인 — 구버전 해시 검증 후 s1으로 승격
  const legacy = fakePersistence();
  legacy.rows.push({
    username: '', email: 'old@x.com', hash: authServer.legacyHash('oldpw123'),
    profile: WIRE, createdAt: '2025-01-01', emailVerified: false,
  });
  const store2 = new authServer.AuthStore(legacy);
  await store2.seed(legacy.rows[0]);
  const login = await store2.login('old@x.com', 'oldpw123');
  assert.equal(login.ok, true, '레거시 해시로도 로그인할 수 있다');
  assert.match(legacy.rows[0].hash, /^s1\$/, '로그인 성공 시 해시가 s1으로 승격된다');
  const badLogin = await store2.login('old@x.com', 'wrong-pw');
  assert.equal(badLogin.ok, false);
});

/* ── §2: 세션 토큰 — 예측 불가능성 ── */
test('session tokens are 24-byte random values, not derived from email', async () => {
  const store = new authServer.AuthStore(fakePersistence());
  await store.register({ username: 'tok_user', email: 'tok@x.com', password: 'secret1', profile: WIRE });
  const t1 = store.createSession('tok@x.com');
  const t2 = store.createSession('tok@x.com');
  assert.ok(!t1.includes('tok'), '토큰에 식별자가 드러나지 않는다');
  assert.notEqual(t1, t2);
  assert.equal(store.sessionEmail(t1), 'tok@x.com');
  assert.equal(store.sessionEmail('forged-token'), null);
});

/* ── A8 서버측: 로그인 readback — 저장된 프로필이 그대로 돌아온다 ──
 * [EMAIL VERIFY 활성] 신규 가입은 인증 대기로 생성되고 서버 토큰 확인으로만 해제된다 —
 * A8은 "인증 후" 로그인 readback 계약을 검증한다 (대기 게이트 자체는 emailVerify.test.cjs EV 계열). */
test('A8-server — login and readback return the stored fit profile', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const reg = await store.register({ username: 'read_user', email: 'read@x.com', password: 'secret1', profile: WIRE });
  assert.equal(reg.ok, true);
  assert.equal(reg.account.verificationPending, true, '신규 가입은 인증 대기다');
  const gated = await store.login('read_user', 'secret1');
  assert.equal(gated.ok, false, '미인증 계정은 로그인이 게이트된다');
  assert.equal(gated.code, 'EMAIL_NOT_VERIFIED');
  const marked = await store.markEmailVerified('read@x.com');
  assert.ok(marked, '승격은 계정 객체로 돌아온다');
  const login = await store.login('read_user', 'secret1'); // 아이디 로그인
  assert.equal(login.ok, true);
  assert.deepEqual(login.account.profile, JSON.parse(JSON.stringify(reg.account.profile)));
  const acct = store.accountOf(login.token);
  assert.equal(acct.email, 'read@x.com');
  assert.equal(acct.emailVerified, true, '서버 토큰 경로로만 true가 된다');
});

/* ── A9 서버측: 프로필 수정/초기화가 영구 저장소에 반영된다 ── */
test('A9-server — profile update and reset reach the persistent store', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const reg = await store.register({ username: 'edit_user', email: 'e@x.com', password: 'secret1', profile: WIRE });
  const token = store.createSession('e@x.com');
  const upd = await store.updateProfile(token, { gender: '미지정', size: '상의 105', fit: 'A' });
  assert.equal(upd.ok, true);
  assert.equal(p.updated.length, 1);
  assert.deepEqual(store.accountOf(token).profile, { gender: '미지정', size: '상의 105', fit: 'A' });
  const reset = await store.updateProfile(token, undefined, true);
  assert.equal(reset.ok, true);
  assert.equal(p.resets, 1, 'reset은 영구 저장소의 핏 필드를 공백화한다');
  assert.equal(store.accountOf(token).profile.size, '');
  assert.equal(store.accountOf(token).profile.fit, '');
  // 토큰 없이는 아무것도 반영되지 않는다
  const noTok = await store.updateProfile('forged', { fit: 'A' });
  assert.equal(noTok.ok, false);
  assert.equal(p.updated.length, 1);
});

/* ── A6 서버측: 게스트(토큰 없음)는 영구 저장소에 절대 쓸 수 없다 ── */
test('A6-server — unauthenticated profile writes never reach persistence', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const r = await store.updateProfile('', { fit: 'A', size: '상의 100', gender: '미지정' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(p.created.length, 0, '생성도 없다');
  assert.equal(p.updated.length, 0, '갱신도 없다');
  assert.equal(p.rows.length, 0, '시트 행 자체가 생기지 않는다');
});

/* ── §1: username 규칙 단위 ── */
test('username rules — normalization and validation are shared client/server', () => {
  assert.equal(username.normalizeUsername('  Mina_K '), 'mina_k');
  assert.equal(username.validateUsername('good_id_1').ok, true);
  assert.equal(username.validateUsername('한글아이디').ok, false, '이번 기반은 영문 소문자·숫자·_만');
  assert.equal(username.validateUsername('a').ok, false);
  assert.equal(username.validateUsername('x'.repeat(21)).ok, false);
  assert.equal(username.validateUsername('has space').ok, false);
});

/* ── §3: 이메일 확인 계약 — EMAIL_VERIFY_DEFERRED는 활성으로 전환되었다(2026-09-10).
 * 지연 계약의 정직 응답 검증은 emailVerify.test.cjs EV 계열이 대신한다.
 * 탈퇴 정책 코드 계약만 이 자리에 남긴다. ── */
test('withdrawal policy code contract stays intact', async () => {
  const ev = require(path.resolve(__dirname, '../lib/emailVerify.ts'));
  assert.equal(ev.SMARTFIT_ON_WITHDRAWAL, 'DELETE_PERSONALIZATION_KEEP_ORDER_RECORDS');
});
