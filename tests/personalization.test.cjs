/**
 * SESSION J — PERSONALIZATION FULL INTEGRATION 테스트 (J1~J10, TASKS 9·27·28)
 * 실행: node --test tests/personalization.test.cjs
 * 원칙: 네트워크·시트·credential 없이 순수 로직 + 소스 계약만 검증한다 (기존 하니스와 동일).
 *
 * 검증 대상:
 *  - lib/fitDisplay.ts      — 같은 User Fit Context로 페어 상·하의 각각 해석(TASK 27),
 *                             pair 카드 개인화 라인(TASK 28), PDP 치수 라벨(TASK 9)
 *  - lib/fitContext.ts      — 게스트/회원 저장 경계, 로그인 병합·승격, reset/edit (Session A 계약 재검증)
 *  - lib/cart.ts            — 게스트 카트 보존·병합 (Session C 계약 재검증)
 *  - components/AuthProvider.tsx · app/page.tsx · app/product/[id]/page.tsx —
 *    정적 소스 계약: 라우트 생존(강제 HOME reset 부재), 로그아웃 게스트 경계 복귀,
 *    pair row 상품별 라인 렌더, PDP 문구 분리
 *
 * 게스트 마스터 여정(GUEST MASTER JOURNEY)의 6대 불변식이 J3~J9에 걸쳐 잠긴다:
 *  Fit preserved · Cart preserved · current route preserved · current product preserved ·
 *  member Fit persisted · guest Fit not separately persisted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

// @/ 경로 별칭 → 프로젝트 루트 (commerce/returns 하니스와 동일)
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fitDisplay = load('lib/fitDisplay.ts');
const fitCtx = load('lib/fitContext.ts');
const cart = load('lib/cart.ts');

// ── 공통 fixture: 실제 페어(PAIR-MA-01 블랙 셔츠 × 세미와이드 슬랙스) 형태 기반 ──
const CTX = { v: 2, preferredFit: 'A', topSize: '105', bottomSize: '30~31' }; // 정핏 선호
const PAIR_TOP = {
  name: '세미 오버핏 폴리 셔츠', // 실루엣 B — 정핏(A) 선호보다 한 단계 여유
  category: '의류-상의',
  fitShape: 'SHIRT',
  stretch: '보통',
  sizeChart: '한국사이즈 단면(cm) — 95(XL): 어깨46·가슴50·총장68 / 100(2XL): 어깨48·가슴51.5·총장69 / 105(3XL): 어깨50·가슴53·총장71',
  sizeOptions: [],
  optionStock: { '검정_105(XL)': 3 },
  stockStatus: '판매중',
  modelInfo: '177cm/75kg 기준 XL 착용',
};
const PAIR_BOTTOM = {
  name: '세미와이드 슬랙스', // 실루엣 B
  category: '의류-하의',
  fitShape: 'SLACKS',
  stretch: '보통',
  sizeChart: 'SIZE 30(29-31인치): 허리단면 33, 엉덩이단면 53.5, 허벅지단면 31.5, 밑위 28, 총장 100 / SIZE 32(31-33인치): 허리단면 35, 엉덩이단면 55, 허벅지단면 32.5, 밑위 29, 총장 101',
  sizeOptions: [],
  optionStock: { '블랙_30': 2 },
  stockStatus: '판매중',
  modelInfo: '',
};

/** localStorage 계약을 흉내 내는 메모리 스토리지 (테스트 격리) */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
const guestStorage = () => fakeStorage(); // sessionStorage 계약
const memberLocal = () => fakeStorage();  // localStorage 계약

const line = (sku, qty, extra = {}) => ({
  sku, name: `상품 ${sku}`, color: '검정', size: '105(XL)', qty,
  unit_price: 49000, image: null, ...extra,
});

/* ══════════════════════════════════════════════════════════════════
   J1 — PAIR TOP FIT: 같은 User Fit Context로 페어의 상의를 해석한다
   ══════════════════════════════════════════════════════════════════ */
test('J1 — pair top: same User Fit Context resolves the TOP with its own result A', () => {
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, CTX);
  const top = views.top.interpretation;
  assert.ok(top, '컨텍스트가 있으면 상의 해석이 존재한다');
  assert.equal(views.top.slot, 'top');
  assert.equal(top.category, 'top');
  // 상의 해석은 상의 앵커(105)만 쓴다 — 하의 앵커가 새어들지 않는다
  assert.ok(top.yourContext.includes('평소 상의 105'));
  assert.ok(!top.yourContext.includes('하의'));
  // 실루엣 B 상품 × 정핏(A) 선호 → 방향 해석이 나온다 (근거 있는 맥락 연결)
  assert.ok(top.interpretation.includes('한 단계 여유'));
  // 결정적 재현 — 페이지뷰마다 동일 (LLM/난수 없음)
  assert.deepEqual(views, fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, CTX));
});

/* ══════════════════════════════════════════════════════════════════
   J2 — PAIR BOTTOM FIT: 같은 ctx로 하의는 자기 결과(B)를 받는다.
        페어 전체에 하나의 사이즈 추천은 존재하지 않는다.
   ══════════════════════════════════════════════════════════════════ */
test('J2 — pair bottom: same ctx resolves the BOTTOM with its own result B; no pair-level size', () => {
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, CTX);
  const bottom = views.bottom.interpretation;
  assert.ok(bottom);
  assert.equal(views.bottom.slot, 'bottom');
  assert.equal(bottom.category, 'bottom');
  assert.ok(bottom.yourContext.includes('평소 하의 30~31'));
  assert.ok(!bottom.yourContext.includes('상의'));
  // Top A ≠ Bottom B: 같은 컨텍스트라도 상품(슬롯)별 해석·사이즈 앵커가 다르다
  assert.notEqual(views.top.interpretation.yourContext, bottom.yourContext);
  assert.notEqual(fitDisplay.pairFitLine(views.top.interpretation), fitDisplay.pairFitLine(bottom));
  // 계약: 반환은 슬롯별 뷰 2개뿐 — 페어 통합 사이즈 뷰 키는 존재하지 않는다
  assert.deepEqual(Object.keys(views).sort(), ['bottom', 'top']);
  const src = read('lib/fitDisplay.ts');
  assert.ok(!/pairSize|pairRecommendedSize|페어\s*사이즈\s*추천/.test(src),
    '페어 단위 단일 사이즈 함수는 제공되지 않는다');
  // 카드 라인은 방향 해석만 — 근거 없는 exact recommendation(추천 사이즈는 ~) 금지
  const lineTop = fitDisplay.pairFitLine(views.top.interpretation);
  assert.ok(lineTop.startsWith('정핏 선호'));
  assert.ok(!/추천 사이즈는|사이즈 추천|\d+\(?.*\)?\s*추천/.test(lineTop));
  // 소품(UNAVAILABLE)은 라인이 조용히 비워진다 — 핏 규칙 대상 밖
  assert.equal(fitDisplay.pairFitLine({ ...bottom, evidence: 'UNAVAILABLE' }), '');
  assert.equal(fitDisplay.pairFitLine(null), '');
});

/* ══════════════════════════════════════════════════════════════════
   J3 — GUEST FIT: 세션 저장소에만 존재 — 탭 세션 내 내비게이션 생존,
       영구 저장소·서버 기록 부재 (게스트 마스터 여정의 핏 불변식)
   ══════════════════════════════════════════════════════════════════ */
test('J3 — guest fit lives in sessionStorage only and survives the journey', () => {
  const session = guestStorage();
  const local = memberLocal();
  fitCtx.saveGuestFitContext(CTX, session);
  // 탭 세션 내 이동(PDP → 카트 → 페어 브라우즈 → 다른 PDP)에서 동일 컨텍스트
  for (const _ of ['PDP-A', 'cart', 'home-pairs', 'PDP-B']) {
    assert.deepEqual(fitCtx.loadGuestFitContext(session), CTX);
  }
  // 영구 저장소에는 절대 기록되지 않는다 (§6 — guest not separately persisted)
  assert.equal(fitCtx.loadMemberFitContext(local), null);
  assert.equal(local.getItem(fitCtx.FIT_STORAGE_KEY), null);
  // 게스트 컨텍스트로 페어 개인화도 즉시 켜진다
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, fitCtx.loadGuestFitContext(session));
  assert.ok(views.top.interpretation && views.bottom.interpretation);
});

/* ══════════════════════════════════════════════════════════════════
   J4 — GUEST CART: 가입 시점에 게스트 카트가 파괴되지 않고 회원 카트로 합쳐진다
   ══════════════════════════════════════════════════════════════════ */
test('J4 — guest cart lines survive signup (merge, never destroy)', () => {
  const guestLines = [line('PRD-N1-01', 1), line('PRD-N1-14', 2)];
  // CartProvider 로그인 계약: 게스트 보존본 유지 + mergeCarts(회원, 게스트) → 회원 키
  const memberKey = cart.memberCartKey('J4_member@example.com');
  assert.notEqual(memberKey, cart.GUEST_CART_KEY, '회원 카트 키는 게스트 키와 분리');
  const merged = cart.mergeCarts([], guestLines); // 신규 가입 — 회원 카트 비어 있음
  assert.equal(merged.length, 2);
  assert.equal(cart.cartCount(merged), 3);
  assert.deepEqual(merged.map((i) => i.sku), ['PRD-N1-01', 'PRD-N1-14']);
  // 동일 라인 재합성은 수량 병합(상한 캡) — 게스트 사본이 그대로 보존된다
  const again = cart.mergeCarts(merged, guestLines);
  assert.equal(again.length, 2);
  assert.equal(again[0].qty, Math.min(cart.MAX_QTY_PER_LINE, 2));
});

/* ══════════════════════════════════════════════════════════════════
   J5 — SIGNUP: 가입이 핏을 다시 묻지 않고 승격한다
   ══════════════════════════════════════════════════════════════════ */
test('J5 — signup promotes the guest fit without re-asking', () => {
  const session = guestStorage();
  const local = memberLocal();
  fitCtx.saveGuestFitContext(CTX, session);
  // 가입 payload는 기존 /api/auth 프로필 계약 {gender,size,fit}을 그대로 쓴다
  assert.deepEqual(fitCtx.encodeProfileForServer(CTX), {
    gender: '미지정', size: '상의 105 · 하의 30~31', fit: 'A',
  });
  // 승격: 세션 사본 → 회원 기기 슬롯, 세션 사본은 지워진다 (guest copy not separately persisted)
  const promoted = fitCtx.promoteGuestFitToMember(
    fitCtx.mergeOnLogin(null, fitCtx.loadGuestFitContext(session)).ctx,
    session,
    local,
  );
  assert.deepEqual(promoted, CTX);
  assert.deepEqual(fitCtx.loadMemberFitContext(local), CTX);
  assert.equal(fitCtx.loadGuestFitContext(session), null);
  // 재질문 금지 문구 — 두 가입 표면 모두 "다시 묻지 않는다"고 안내한다
  const flow = read('components/SmartFitFlow.tsx');
  const nav = read('components/AuthNav.tsx');
  assert.ok(flow.includes('방금 설정한 핏이 그대로 저장됩니다'));
  assert.ok(nav.includes('다시 답하지 않고 이대로 시작할 수 있어요'));
});

/* ══════════════════════════════════════════════════════════════════
   J6 — FIT PROMOTION: 로그인 병합 — 서버 비면 게스트 승격, 서버 있으면 계정 기억 승리
   ══════════════════════════════════════════════════════════════════ */
test('J6 — login merge promotes guest fit when the account is empty; server wins otherwise', () => {
  // 서버에 핏이 없는 계정 → 게스트가 방금 만든 핏이 살아남고 서버로 승격된다
  const r1 = fitCtx.mergeOnLogin({ gender: '미지정', size: '', fit: '' }, CTX);
  assert.deepEqual(r1.ctx, CTX);
  assert.equal(r1.syncToServer, true);
  // 서버에 핏이 있는 계정 → 계정 기억(다른 기기 값)이 이긴다
  const server = { gender: '미지정', size: '상의 95 · 하의 28~29', fit: 'B' };
  const r2 = fitCtx.mergeOnLogin(server, CTX);
  assert.equal(r2.ctx.preferredFit, 'B');
  assert.equal(r2.ctx.topSize, '95');
  assert.equal(r2.ctx.bottomSize, '28~29');
  assert.equal(r2.syncToServer, false);
  // 승격된 값도 페어 개인화에 그대로 쓰인다 — 병합 결과가 곧 표시 상태다
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, r2.ctx);
  assert.ok(views.top.interpretation.yourContext.includes('평소 상의 95'));
});

/* ══════════════════════════════════════════════════════════════════
   J7 — CART SURVIVAL: 로그아웃해도 회원 카트는 회원 키에 남고
        게스트는 게스트 보존본으로 돌아간다 (CartProvider 계약 재검증)
   ══════════════════════════════════════════════════════════════════ */
test('J7 — logout keeps the member cart under its key and restores the guest copy', () => {
  const store = fakeStorage();
  const memberKey = cart.memberCartKey('J7_member@example.com');
  const guestLines = [line('PRD-N1-01', 1)];
  const memberLines = [line('PRD-N1-14', 1)];
  // 로그인 전 게스트 적립
  store.setItem(cart.GUEST_CART_KEY, JSON.stringify(guestLines));
  // 로그인: 게스트 보존본 유지 + 병합 결과 회원 키
  const merged = cart.mergeCarts(memberLines, cart.parseCart(store.getItem(cart.GUEST_CART_KEY)));
  store.setItem(memberKey, JSON.stringify(merged));
  assert.equal(cart.cartCount(cart.parseCart(store.getItem(memberKey))), 2);
  // 로그아웃: 활성 카트는 게스트 보존본으로 복귀 — 회원 키는 파괴되지 않는다
  const afterLogout = cart.parseCart(store.getItem(cart.GUEST_CART_KEY));
  assert.deepEqual(afterLogout.map((i) => [i.sku, i.qty]), [["PRD-N1-01", 1]]);
  assert.equal(cart.cartCount(cart.parseCart(store.getItem(memberKey))), 2, '회원 카트 보존');
  // 재로그인: mergeCarts 계약으로 재합성 (게스트가 그 사이 담은 것도 합쳐진다)
  const guestAdded = [line('PRD-N1-01', 1), line('PRD-N1-20', 1)];
  store.setItem(cart.GUEST_CART_KEY, JSON.stringify(guestAdded));
  const remerged = cart.mergeCarts(cart.parseCart(store.getItem(memberKey)), guestAdded);
  assert.deepEqual(remerged.map((i) => i.sku).sort(), ['PRD-N1-01', 'PRD-N1-14', 'PRD-N1-20']);
  // 신원 정규화 — 이메일 대소문자·공백이 키를 갈라놓지 않는다
  assert.equal(cart.memberCartKey('J7.MEMBER@example.com '), memberKey.replace('j7_member', 'j7.member'));
});

/* ══════════════════════════════════════════════════════════════════
   J8 — ROUTE SURVIVAL: 인증 중단(Smart Fit → 가입 / Cart → 로그인)이
        HOME으로 강제 reset하지 않는다 — 인증 표면은 내비게이션이 없다
   ══════════════════════════════════════════════════════════════════ */
test('J8 — auth surfaces never navigate: no forced HOME reset after signup/login', () => {
  for (const rel of ['components/SmartFitFlow.tsx', 'components/AuthNav.tsx', 'components/AuthProvider.tsx']) {
    const src = read(rel);
    assert.ok(!src.includes('useRouter'), `${rel}: router 의존 없음 (모달 기반 인증)`);
    assert.ok(!/router\.push|router\.replace|window\.location|location\.href/.test(src),
      `${rel}: 내비게이션 호출 부재`);
  }
  // 앱 전체에서 강제 홈 리셋 경로 부재 (인증 후·모달 종료 후 모두)
  for (const rel of ['app/page.tsx', 'app/product/[id]/page.tsx', 'components/CartDrawer.tsx', 'components/CheckoutFlow.tsx']) {
    const src = read(rel);
    assert.ok(!/push\(["']\/["']\)|replace\(["']\/["']\)|href\s*=\s*["']\/["']\s*\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')) ||
      rel === 'app/page.tsx', // 홈 자신의 history.replaceState(탭 파라미터 정리)는 reset이 아님
      `${rel}: 강제 HOME 이동 없음`);
  }
  // 인텐트 보존 — PDP에서 핏 플로우는 오버레이로 열리고 상품 컨텍스트를 유지한다
  const pdp = read('app/product/[id]/page.tsx');
  assert.ok(pdp.includes('showFitFlow') && pdp.includes('product={fitInput}'));
  // 카트 → 로그인: 카트 드로어의 결제 진입은 /checkout로만 가고 인증은 헤더 모달
  const drawer = read('components/CartDrawer.tsx');
  assert.ok(drawer.includes('router.push("/checkout")'));
});

/* ══════════════════════════════════════════════════════════════════
   J9 — RETURNING MEMBER: logout이 화면 상태를 게스트 경계로 되돌리고,
        login이 계정 핏을 복원해 Pair/PDP 개인화가 즉시 켜진다
   ══════════════════════════════════════════════════════════════════ */
test('J9 — logout returns to the guest boundary; login restores the profile and applies it immediately', () => {
  const session = guestStorage();
  const local = memberLocal();
  // 회원이 핏을 저장(기기 슬롯 + 서버 인코딩)
  fitCtx.saveMemberFitContext(CTX, local);
  const serverProfile = fitCtx.encodeProfileForServer(CTX);
  // 로그아웃: 화면 상태는 게스트 세션 컨텍스트로 복귀 (Session J AuthProvider 계약)
  const auth = read('components/AuthProvider.tsx');
  assert.ok(auth.includes('setFit(loadGuestFitContext())'), 'logout이 fit을 게스트 경계로 되돌린다');
  const afterLogoutFit = fitCtx.loadGuestFitContext(session); // 게스트 세션에는 핏이 없다
  assert.equal(afterLogoutFit, null);
  // 게스트 상태에서는 개인화 자체가 없다 — 조용한 비활성 (빈 라인, null 해석)
  assert.equal(fitDisplay.pairFitLine(require(path.join(ROOT, 'lib/fit.ts')).interpretFit(PAIR_TOP, afterLogoutFit)), '');
  // 재로그인: 서버 프로필 병합으로 계정 핏 복원
  const { ctx: restored } = fitCtx.mergeOnLogin(serverProfile, afterLogoutFit);
  assert.equal(restored.preferredFit, 'A');
  assert.equal(restored.topSize, '105');
  assert.equal(restored.bottomSize, '30~31');
  // 복원 즉시 Pair/PDP에 적용 — 같은 순수 함수가 화면 라인을 만든다
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, restored);
  assert.ok(fitDisplay.pairFitLine(views.top.interpretation).includes('정핏 선호'));
  assert.ok(fitDisplay.pairFitLine(views.bottom.interpretation).includes('평소 하의 30~31'));
  // 빈 계정 로그인: 이전 계정의 기기 슬롯 핏이 새 계정으로 새어들지 않게 슬롯을 재바인딩
  assert.ok(auth.includes('clearFitContext(localStorage)'), '빈 병합 시 기기 슬롯 재바인딩');
  const emptyLocal = memberLocal();
  fitCtx.saveMemberFitContext({ v: 2, preferredFit: 'C', topSize: '95' }, emptyLocal); // 이전 계정 잔존
  fitCtx.clearFitContext(emptyLocal); // login else-분기 계약
  assert.equal(fitCtx.loadMemberFitContext(emptyLocal), null);
});

/* ══════════════════════════════════════════════════════════════════
   J10 — RESET / EDIT: reset은 기기+서버까지 지우고, edit는 양쪽에 반영된다
   ══════════════════════════════════════════════════════════════════ */
test('J10 — reset clears device+session+server flag; edit updates the stored context', () => {
  const session = guestStorage();
  const local = memberLocal();
  // edit: 값 교체가 저장소에 그대로 반영
  fitCtx.saveMemberFitContext(CTX, local);
  const edited = { v: 2, preferredFit: 'B', topSize: '100', bottomSize: '30~31' };
  fitCtx.saveMemberFitContext(edited, local);
  assert.equal(fitCtx.loadMemberFitContext(local).preferredFit, 'B');
  // 개인화 라인도 수정값을 즉시 반영
  const views = fitDisplay.pairFitViews(PAIR_TOP, PAIR_BOTTOM, edited);
  assert.ok(fitDisplay.pairFitLine(views.top.interpretation).includes('세미오버 선호'));
  // reset: 양쪽 저장소 공백화 + 서버 초기화 플래그 계약
  fitCtx.saveGuestFitContext(edited, session);
  fitCtx.clearFitContext(local);
  fitCtx.clearFitContext(session);
  assert.equal(fitCtx.loadMemberFitContext(local), null);
  assert.equal(fitCtx.loadGuestFitContext(session), null);
  assert.equal(fitCtx.RESET_FIT_PROFILE_FLAG, 'resetFitProfile');
  const auth = read('components/AuthProvider.tsx');
  assert.ok(auth.includes('[RESET_FIT_PROFILE_FLAG]: true'), '회원 reset은 서버 공백화까지 호출');
  // reset 후 PDP는 개인 해석 없이 진입 버튼으로 조용히 돌아간다
  const pdp = read('app/product/[id]/page.tsx');
  assert.ok(/fitInterp \? /.test(pdp) && pdp.includes('스마트 핏 →'), '미설정 게스트 진입 경로 유지');
});

/* ══════════════════════════════════════════════════════════════════
   TASK 9 — PDP COPY: "내 설정 — …" → 라벨 "내가 설정한 치수" + 값 두 줄 분리
   ══════════════════════════════════════════════════════════════════ */
test('TASK 9 — PDP your-fit copy: label «내가 설정한 치수» above the context value', () => {
  assert.equal(fitDisplay.MY_DIMENSIONS_LABEL, '내가 설정한 치수');
  const pdp = read('app/product/[id]/page.tsx');
  assert.ok(pdp.includes('{MY_DIMENSIONS_LABEL}'), '라벨 상수 사용');
  assert.ok(/\{fitInterp\.yourContext\}/.test(pdp), '값은 interpretFit.yourContext 그대로');
  assert.ok(!pdp.includes('내 설정 — '), '구 접두사 잔존 없음');
  // 값 형태 — yourContext가 미션 예시 문구("정핏 선호 · 평소 상의 105")를 만든다
  const interp = require(path.join(ROOT, 'lib/fit.ts')).interpretFit(PAIR_TOP, CTX);
  assert.equal(interp.yourContext, '정핏 선호 · 평소 상의 105');
  // 두 줄 구조 — 라벨 요소가 값 요소보다 먼저 온다 (DOM 순서)
  const labelIdx = pdp.indexOf('{MY_DIMENSIONS_LABEL}');
  const valueIdx = pdp.indexOf('{fitInterp.yourContext}');
  assert.ok(labelIdx > -1 && valueIdx > labelIdx, '라벨 → 값 순서');
  const css = read('app/product/[id]/product.module.css');
  assert.ok(css.includes('.yourFitDimsLabel') && css.includes('.yourFitDims'), '분리 스타일 실재');
});

/* ══════════════════════════════════════════════════════════════════
   TASKS 27·28 — PAIR DISPLAY CONTEXT: pair row 상품별 라인 렌더 소스 계약
   ══════════════════════════════════════════════════════════════════ */
test('TASKS 27·28 — pair rows render a per-product fit line from E mapping × User Fit Context', () => {
  const home = read('app/page.tsx');
  // 페어 카드 루프 안에서 상품별 해석 → 라인 (row 밖 공유 라인 아님)
  assert.ok(home.includes('pairFitLine(interpretFit(fitInputOf(p), fit))'),
    '상품(p)별 해석이 카드 루프 안에서 계산된다');
  assert.ok(home.includes('className="piece-fit"'), '카드 캡션에 piece-fit 라인');
  assert.ok(home.includes('fitInputOf'), 'interpretFit 입력 조립 헬퍼');
  // E의 사전 계산 mapping 소비 — 프론트 조합 생성·스코어 노출 없음 (기존 계약 유지)
  assert.ok(home.includes('buildCollectionPairs'));
  assert.ok(!/pair_score|pairScoreInternal|score_breakdown/.test(home));
  // PDP 함께 보기(짝 상품)에도 같은 컨텍스트 라인
  const pdp = read('app/product/[id]/page.tsx');
  assert.ok(pdp.includes('pairFitLine(interpretFit(suggestion.fitInput, fit))'),
    'PDP 짝 상품 라인도 렌더 시점 fit으로 계산(수정·복원 즉시 반영)');
  const homeCss = read('app/globals.css');
  assert.ok(homeCss.includes('.piece-fit'), 'piece-fit 스타일 실재');
  const pdpCss = read('app/product/[id]/product.module.css');
  assert.ok(pdpCss.includes('.pairFitLine'), 'PDP 짝 상품 라인 스타일 실재');
});
