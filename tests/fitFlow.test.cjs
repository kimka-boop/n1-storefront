/**
 * SESSION A — SMART FIT FLOW MACHINE TESTS (A10·A11)
 *
 * lib/fitFlow.ts를 실제 TypeScript로 실행한다 — 뒤로 가기(§4)와
 * 상의→하의→결과 흐름(§5), 재질문 금지(§5·§9)를 검증한다.
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
const flow = require(path.resolve(__dirname, '../lib/fitFlow.ts'));

const FIT = { v: 2, preferredFit: 'C' };
const FIT_TOP = { v: 2, preferredFit: 'C', topSize: '100' };
const FIT_BOTH = { v: 2, preferredFit: 'C', topSize: '100', bottomSize: '30~31' };

/* ── A11: 상의 → 하의 → 결과 — 상의 답 후 바로 결과로 가지 않는다 ── */
test('A11 — Top context → Bottom context → Result', () => {
  // 새 게스트: 핏을 고르면 상의부터 묻는다
  let st = flow.initialFlowState(null, null);
  assert.equal(st.step, 'fit');
  st = flow.stateAfterFit(st, FIT, null);
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'top');
  // 상의를 답했다 — 결과로 튀지 않고 하의를 이어 묻는다(§5 수정)
  st = flow.stateAfterSize(st, FIT_TOP);
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'bottom');
  // 하의를 답하면 그제서야 결과
  st = flow.stateAfterSize(st, FIT_BOTH);
  assert.equal(st.step, 'result');
});

/* ── A11b: 이미 아는 값은 다시 묻지 않는다 ── */
test('A11b — known sizes are never re-asked', () => {
  // 상의를 아는 게스트 — 하의만 묻고 끝나면 결과
  let st = flow.initialFlowState({ v: 2, preferredFit: 'B', topSize: '95' }, null);
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'bottom', '상의를 아니므로 하의만 묻는다');
  st = flow.stateAfterSize(st, FIT_BOTH);
  assert.equal(st.step, 'result');
  // 둘 다 아는 게스트 — 사이즈 질문 없이 바로 결과
  const done = flow.initialFlowState(FIT_BOTH, null);
  assert.equal(done.step, 'result');
  // 핏을 고른 뒤에도 마찬가지 — 알 값은 큐에서 제외된다
  const q = flow.pendingSizeQueue(FIT_TOP, null);
  assert.deepEqual(q, ['bottom']);
});

/* ── A11c: 하의 상품 PDP(needCategory=bottom) — 하의를 먼저 묻고 상의를 이어 묻는다 ── */
test('A11c — a bottom PDP asks bottom first, then completes the top context', () => {
  let st = flow.initialFlowState(null, 'bottom');
  assert.equal(st.step, 'fit');
  st = flow.stateAfterFit(st, FIT, 'bottom');
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'bottom', '하의 상품이니 하의 기준으로 먼저 묻는다');
  st = flow.stateAfterSize(st, { ...FIT, bottomSize: '30~31' });
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'top', '상의 컨텍스트가 비어 있으면 이어서 묻는다');
  st = flow.stateAfterSize(st, { ...FIT, bottomSize: '30~31', topSize: '100' });
  assert.equal(st.step, 'result');
});

/* ── A10: 뒤로 가기 — 이전 단계로 돌아가고 선택이 유지된다 ── */
test('A10 — back control: hidden on entry step, pops history on later steps', () => {
  // 진입 단계( fit ) — 뒤로 숨김(§4)
  let st = flow.initialFlowState(null, null);
  assert.equal(flow.canGoBack(st), false);
  // fit → size(top) — 뒤로 보이고, pop하면 fit
  st = flow.stateAfterFit(st, FIT, null);
  assert.equal(flow.canGoBack(st), true);
  st = flow.goBack(st);
  assert.equal(st.step, 'fit');
  assert.equal(flow.canGoBack(st), false, '다시 진입 단계 — 뒤로 숨김');
  // fit → size(top) → size(bottom) → result → back → back → back
  st = flow.initialFlowState(null, null);
  st = flow.stateAfterFit(st, FIT, null);
  st = flow.stateAfterSize(st, FIT_TOP);
  assert.equal(st.sizeTab, 'bottom');
  st = flow.stateAfterSize(st, FIT_BOTH);
  assert.equal(st.step, 'result');
  st = flow.goBack(st);
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'bottom', 'size 단계로 돌아가면 그때 묻던 컨텍스트를 복원한다');
  st = flow.goBack(st);
  assert.equal(st.step, 'size');
  assert.equal(st.sizeTab, 'top');
  st = flow.goBack(st);
  assert.equal(st.step, 'fit');
  // 이력 끝에서의 뒤로는 no-op — 깨진 상태를 만들지 않는다
  const same = flow.goBack(st);
  assert.deepEqual(same, st);
});

/* ── A10b: 결과에서 "설정 수정" — 핏 질문부터 다시, 뒤로하면 결과 복원 ── */
test('A10b — edit from result re-opens fit; back returns to result', () => {
  let st = flow.initialFlowState(FIT_BOTH, null);
  assert.equal(st.step, 'result');
  st = flow.stateToEdit(st);
  assert.equal(st.step, 'fit');
  st = flow.goBack(st);
  assert.equal(st.step, 'result');
});

/* ── A10c: 결과 → 계정 단계 — 뒤로하면 결과로 돌아간다 ── */
test('A10c — account step goes back to result (login entry point preserved)', () => {
  let st = flow.initialFlowState(FIT_BOTH, null);
  assert.equal(st.step, 'result');
  st = flow.stateToAccount(st);
  assert.equal(st.step, 'account');
  st = flow.goBack(st);
  assert.equal(st.step, 'result');
});
