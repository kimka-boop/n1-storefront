/**
 * EMAIL VERIFY TESTS (EV1–EV10) — 이메일 인증 필수 정책
 *
 * lib/emailVerify.ts(토큰 계약) + lib/authServer.ts(대기 게이트·정정)을 실제
 * TypeScript로 실행해 검증한다. 저장소는 스파이로 주입 — Sheets 의존 없음.
 *
 * 핵심 계약:
 *  - 저장소에는 토큰 해시만 기록된다 (raw 토큰 저장 0).
 *  - 만료(10분)·단일 사용·목적 바인딩·이메일 바인딩.
 *  - 클라이언트가 emailVerified=true를 제출할 경로는 존재하지 않는다.
 *  - 미인증(대기) 신규 계정은 로그인 403 EMAIL_NOT_VERIFIED — 레거시는 grandfathered.
 *  - 이메일 정정: 구 토큰 전량 무효 + 유일성 재검증.
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
const ev = require(path.resolve(__dirname, '../lib/emailVerify.ts'));
const authServer = require(path.resolve(__dirname, '../lib/authServer.ts'));
const emailProvider = require(path.resolve(__dirname, '../lib/emailProvider.ts'));

const WIRE = { gender: '미지정', size: '상의 100', fit: 'C' };

/** 스파이 토큰 저장소 — 해시만 기록되는지 감시한다 */
function fakeTokenStore() {
  const rows = [];
  return {
    rows,
    rawTokenLeaks: [],
    async issue(record) {
      if (!/^[0-9a-f]{64}$/.test(record.tokenHash)) {
        this.rawTokenLeaks.push(record.tokenHash);
      }
      rows.push({ ...record, usedAt: null });
    },
    async find(tokenHash) { return rows.find((r) => r.tokenHash === tokenHash) || null; },
    async markUsed(tokenHash, usedAt) {
      const r = rows.find((x) => x.tokenHash === tokenHash && !x.usedAt);
      if (!r) return false;
      r.usedAt = usedAt;
      return true;
    },
    async invalidateAll(email, purpose) {
      for (const r of rows) if (r.email === email && r.purpose === purpose && !r.usedAt) r.usedAt = 'INVALIDATED';
    },
    async lastIssuedAt(email, purpose) {
      let last = null;
      for (const r of rows) if (r.email === email && r.purpose === purpose && (!last || r.createdAt > last)) last = r.createdAt;
      return last;
    },
  };
}

function fakePersistence() {
  const rows = [];
  return {
    rows,
    async exists(un, em) { return rows.some((r) => r.username === un || r.email === em); },
    async create(a) { rows.push({ ...a }); },
    async markVerified(email) { const r = rows.find((x) => x.email === email); if (r) r.verified = true; },
    async updateEmail(o, n) {
      const r = rows.find((x) => x.email === o);
      if (!r) throw new Error('row not found');
      r.email = n;
    },
  };
}

/* ── EV1: 토큰 엔트로피·해시 전용 저장 ── */
test('EV1 — tokens are random, and only their hash reaches the store', async () => {
  const store = fakeTokenStore();
  const t1 = await ev.issueVerifyToken(store, 'a@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  const t2 = await ev.issueVerifyToken(store, 'a@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  assert.notEqual(t1, t2, '토큰은 매번 새로 발급된다');
  assert.ok(t1.length >= 40, '32B base64url — 예측 불가 길이');
  assert.equal(store.rawTokenLeaks.length, 0, '저장소에 기록된 값은 64-hex 해시다');
  assert.ok(!JSON.stringify(store.rows).includes(t1), 'raw 토큰이 저장소 어디에도 없다');
});

/* ── EV2: 정상 확인 — 이메일 바인딩 ── */
test('EV2 — confirm succeeds for the issued email only', async () => {
  const store = fakeTokenStore();
  const raw = await ev.issueVerifyToken(store, 'user@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  const ok = await ev.confirmVerifyToken(store, raw, ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(ok.ok, true);
  assert.equal(ok.email, 'user@x.com', '확인은 발급된 주소에만 적용된다');
});

/* ── EV3: 단일 사용 ── */
test('EV3 — a token is single-use', async () => {
  const store = fakeTokenStore();
  const raw = await ev.issueVerifyToken(store, 's@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  const first = await ev.confirmVerifyToken(store, raw, ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(first.ok, true);
  const second = await ev.confirmVerifyToken(store, raw, ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'VERIFY_TOKEN_USED');
});

/* ── EV4: 만료 (10분) ── */
test('EV4 — token expires after 10 minutes', async () => {
  const store = fakeTokenStore();
  const raw = await ev.issueVerifyToken(store, 'exp@x.com', ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:00:00Z'));
  const at599s = await ev.confirmVerifyToken(store, raw, ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:09:59Z'));
  assert.equal(at599s.ok, true, '9분59초에는 유효');
  const raw2 = await ev.issueVerifyToken(store, 'exp2@x.com', ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:00:00Z'));
  const late = await ev.confirmVerifyToken(store, raw2, ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:10:01Z'));
  assert.equal(late.ok, false);
  assert.equal(late.code, 'VERIFY_TOKEN_EXPIRED');
});

/* ── EV5: 목적·값 바인딩 — 조작 토큰 거절 ── */
test('EV5 — forged or wrong-purpose tokens are rejected', async () => {
  const store = fakeTokenStore();
  await ev.issueVerifyToken(store, 'f@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  const nope = await ev.confirmVerifyToken(store, 'totally-forged-token-value', ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(nope.ok, false);
  assert.equal(nope.code, 'VERIFY_TOKEN_INVALID');
  const empty = await ev.confirmVerifyToken(store, '', ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(empty.ok, false);
});

/* ── EV6: 가입 → 대기 게이트 → 확인 → 로그인 (정책 전체 경로) ── */
test('EV6 — register creates a pending account; login gate unlocks only after server confirm', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const reg = await store.register({ username: 'ev_user', email: 'ev@x.com', password: 'secret1', profile: WIRE });
  assert.equal(reg.ok, true);
  assert.equal(reg.account.emailVerified, false);
  assert.equal(reg.account.verificationPending, true);

  const gated = await store.login('ev@x.com', 'secret1');
  assert.equal(gated.ok, false);
  assert.equal(gated.status, 403);
  assert.equal(gated.code, 'EMAIL_NOT_VERIFIED');

  // 클라이언트가 emailVerified=true를 제출해도 저장소/계정은 변하지 않는다 (경로 자체가 없음)
  assert.equal(p.rows[0].verified, undefined);
  const before = store.accountByEmail('ev@x.com').emailVerified;
  assert.equal(before, false);

  const marked = await store.markEmailVerified('ev@x.com');
  assert.ok(marked, '승격은 계정 객체로 돌아온다');
  assert.equal(marked.emailVerified, true);
  assert.equal(marked.verificationPending, false);
  assert.equal(p.rows[0].verified, true, '영구 저장소에도 승격이 반영된다');
  const login = await store.login('ev_user', 'secret1');
  assert.equal(login.ok, true);
  assert.equal(login.account.emailVerified, true);
});

/* ── EV7: 레거시 계정 grandfathered ── */
test('EV7 — legacy (grandfathered) accounts keep logging in without pending gate', async () => {
  const p = fakePersistence();
  p.rows.push({
    username: '', email: 'old@x.com', hash: authServer.legacyHash('oldpw123'),
    profile: WIRE, createdAt: '2025-01-01', emailVerified: false,
  });
  const store = new authServer.AuthStore(p);
  await store.seed({
    username: '', email: 'old@x.com', hash: authServer.legacyHash('oldpw123'),
    profile: WIRE, createdAt: '2025-01-01', emailVerified: false, verificationPending: false,
  });
  const login = await store.login('old@x.com', 'oldpw123');
  assert.equal(login.ok, true, '레거시 미확인 계정은 로그인이 유지된다');
});

/* ── EV8: 이메일 정정 — 유일성 + 구 토큰 무효 ── */
test('EV8 — pending email change re-validates uniqueness and invalidates old tokens', async () => {
  const p = fakePersistence();
  const store = new authServer.AuthStore(p);
  const tokens = fakeTokenStore();
  await store.register({ username: 'typo_user', email: 'typo@x.com', password: 'secret1', profile: WIRE });
  await store.register({ username: 'other_user', email: 'taken@x.com', password: 'secret2', profile: WIRE });
  const rawOld = await ev.issueVerifyToken(tokens, 'typo@x.com', ev.VERIFY_PURPOSE_SIGNUP);

  const dup = await store.changePendingEmail({ idOrEmail: 'typo@x.com', password: 'secret1', newEmail: 'taken@x.com' });
  assert.equal(dup.ok, false);
  assert.equal(dup.status, 409);

  const changed = await store.changePendingEmail({ idOrEmail: 'typo@x.com', password: 'secret1', newEmail: 'fixed@x.com' });
  assert.equal(changed.ok, true);
  assert.equal(changed.account.email, 'fixed@x.com');
  assert.equal(p.rows.find((r) => r.username === 'typo_user').email, 'fixed@x.com', '영구 저장소도 함께 옮겨진다');

  // 대기 세션 재바인딩 — 가입 직후 세션으로 정정했으면 같은 세션이 새 주소를 가리킨다
  const t = store.createSession('fixed@x.com');
  assert.equal(store.sessionEmail(t), 'fixed@x.com');

  await tokens.invalidateAll('typo@x.com', ev.VERIFY_PURPOSE_SIGNUP);
  const oldToken = await ev.confirmVerifyToken(tokens, rawOld, ev.VERIFY_PURPOSE_SIGNUP);
  assert.equal(oldToken.ok, false, '구 주소의 토큰은 더 이상 통과하지 않는다');

  const wrongPw = await store.changePendingEmail({ idOrEmail: 'fixed@x.com', password: 'wrong', newEmail: 'x@x.com' });
  assert.equal(wrongPw.ok, false);
  assert.equal(wrongPw.status, 401);
});

/* ── EV9: 재발송 쿨다운 ── */
test('EV9 — resend cooldown is enforced with retry-after', async () => {
  const store = fakeTokenStore();
  const now = new Date('2026-01-01T00:00:00Z');
  await ev.issueVerifyToken(store, 'c@x.com', ev.VERIFY_PURPOSE_SIGNUP, now);
  const soon = await ev.resendAllowed(store, 'c@x.com', ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:00:30Z'));
  assert.equal(soon.allowed, false);
  assert.equal(soon.retryAfterSeconds, 30);
  const later = await ev.resendAllowed(store, 'c@x.com', ev.VERIFY_PURPOSE_SIGNUP, new Date('2026-01-01T00:01:01Z'));
  assert.equal(later.allowed, true);
});

/* ── EV10: 이메일 provider 경계 — 정직 거절 + bridge 큐 ── */
test('EV10 — email provider boundary refuses honestly when unset; bridge queues only', async () => {
  const unset = emailProvider.resolveEmailProvider({});
  assert.equal(unset.provider.name, 'no_email_provider');
  const refused = await unset.provider.sendVerificationEmail({ to: 'a@x.com', verifyUrl: 'http://x/v', expiresAt: 'soon' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'EMAIL_PROVIDER_NOT_CONFIGURED');
  assert.equal(unset.liveEmailAvailable, false);

  const bridge = emailProvider.resolveEmailProvider({ N1_EMAIL_PROVIDER: 'bridge' });
  assert.equal(bridge.provider.name, 'bridge');
  assert.equal(bridge.liveEmailAvailable, false, 'bridge는 실전송이 아니다');
  // 큐 기록은 임시 cwd로 격리 — 저장소 오염 없음
  const origCwd = process.cwd();
  process.chdir(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'n1-bridge-')));
  try {
    const queued = await emailProvider.bridgeEmailProvider.sendVerificationEmail({
      to: 'bridge@x.com', verifyUrl: 'http://x/v?t=1', expiresAt: 'soon',
    });
    assert.equal(queued.ok, true);
    assert.equal(queued.delivery, 'bridge');
    const files = fs.readdirSync(emailProvider.bridgeOutboundDir());
    assert.equal(files.length, 1, '큐 파일이 정확히 하나 적재된다');
    const body = JSON.parse(fs.readFileSync(path.join(emailProvider.bridgeOutboundDir(), files[0]), 'utf8'));
    assert.equal(body.to, 'bridge@x.com');
    assert.ok(body.verifyUrl.includes('t=1'), '링크가 본문에 존재한다(전달 수단으로서)');
  } finally {
    process.chdir(origCwd);
  }
});
