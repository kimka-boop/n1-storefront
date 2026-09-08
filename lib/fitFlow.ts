/**
 * N°1 Smart Fit FLOW MACHINE (Session A §4·§5, 2026-09-09)
 *
 * 흐름 규칙:
 *  - 선호 핏 → 필요한 사이즈 컨텍스트(상의/하의) → 결과.
 *  - 사이즈 큐는 "아직 모르는 값만" 담는다 — 이미 아는 값은 다시 묻지 않는다.
 *  - 진입 맥락(needCategory)이 하의면 하의를 먼저 묻고, 그 다음 남은 컨텍스트를
 *    이어 묶어 수집한 뒤 결과로 간다. 상의 입력 후 바로 결과로 튀지 않는다(§5 수정).
 *  - 뒤로 가기는 단계 이력 스택: pop하면 이전 단계로 돌아가고, 그때 답했던
 *    선택은 컨텍스트에 저장되어 그대로 복원된다(수정 실수 대응, §4).
 *  - React에 의존하지 않는 순수 머신 — tests/fitFlow.test.cjs(A10·A11)가 검증.
 */
import type { FitContext } from "./fitContext";

export type SizeTab = "top" | "bottom";
export type Step = "fit" | "size" | "result" | "account" | "confirm";

export interface FlowEntry {
  step: Step;
  sizeTab?: SizeTab; // size 단계였다면 그때 묻던 컨텍스트
}

export interface FitFlowState {
  step: Step;
  /** size 단계에서 현재 묻는 컨텍스트 */
  sizeTab: SizeTab;
  /** 뒤로 가기 이력 — 비어 있으면 진입 단계(뒤로 숨김, §4) */
  history: FlowEntry[];
}

/** 현재 아는 값을 제외하고 물어야 할 사이즈 컨텍스트 큐 (재질문 금지). */
export function pendingSizeQueue(
  ctx: Pick<FitContext, "topSize" | "bottomSize"> | null,
  needCategory: SizeTab | null,
): SizeTab[] {
  const first: SizeTab = needCategory ?? "top";
  const second: SizeTab = first === "top" ? "bottom" : "top";
  const known = (t: SizeTab) =>
    t === "top" ? Boolean(ctx?.topSize) : Boolean(ctx?.bottomSize);
  return [first, second].filter((t) => !known(t));
}

/** 진입 단계: 핏을 모르면 fit, 모르는 사이즈가 있으면 size, 다 알면 result. */
export function initialFlowState(
  ctx: FitContext | null,
  needCategory: SizeTab | null,
): FitFlowState {
  if (!ctx?.preferredFit) return { step: "fit", sizeTab: needCategory ?? "top", history: [] };
  const queue = pendingSizeQueue(ctx, needCategory);
  if (queue.length === 0) return { step: "result", sizeTab: needCategory ?? "top", history: [] };
  return { step: "size", sizeTab: queue[0], history: [] };
}

/** 선호 핏 선택 후 — 남은 사이즈 질문이 있으면 size, 없으면 result. */
export function stateAfterFit(
  state: FitFlowState,
  ctx: FitContext,
  needCategory: SizeTab | null,
): FitFlowState {
  const queue = pendingSizeQueue(ctx, needCategory);
  return {
    step: queue.length ? "size" : "result",
    sizeTab: queue.length ? queue[0] : state.sizeTab,
    history: [...state.history, { step: "fit" }],
  };
}

/**
 * 한 사이즈를 답한 후 — ctx에는 방금 답이 반영되어 있어야 하고, 큐에 남은
 * 컨텍스트가 있으면 이어서 묻는다. 없으면 result(§5 — 상의 후 바로 결과 금지는
 * "하의도 모르는데" 경우이고, 다 알면 result가 맞다).
 */
export function stateAfterSize(state: FitFlowState, ctx: FitContext): FitFlowState {
  const queue = pendingSizeQueue(ctx, null);
  return {
    step: queue.length ? "size" : "result",
    sizeTab: queue.length ? queue[0] : state.sizeTab,
    history: [...state.history, { step: state.step, sizeTab: state.sizeTab }],
  };
}

/** 결과에서 설정 수정으로 — 핏 질문부터 다시 본다(이미 아는 값은 fit 선택 시 스킵). */
export function stateToEdit(state: FitFlowState): FitFlowState {
  return {
    step: "fit",
    sizeTab: state.sizeTab,
    history: [...state.history, { step: state.step, sizeTab: state.sizeTab }],
  };
}

/** 뒤로 가기 — 이력을 pop한다. 이력이 비으면 진입 단계이므로 그대로(컨트롤 숨김). */
export function goBack(state: FitFlowState): FitFlowState {
  if (!state.history.length) return state;
  const history = state.history.slice(0, -1);
  const prev = state.history[state.history.length - 1];
  return { step: prev.step, sizeTab: prev.sizeTab ?? state.sizeTab, history };
}

/** 뒤로 컨트롤 표시 여부 — 진입 단계에서는 숨긴다(§4). */
export function canGoBack(state: FitFlowState): boolean {
  return state.history.length > 0;
}

/** 결과/확인 이후 계정 단계 — 로그인/회원가입 전환도 이력에 적는다. */
export function stateToAccount(state: FitFlowState): FitFlowState {
  return {
    step: "account",
    sizeTab: state.sizeTab,
    history: [...state.history, { step: state.step, sizeTab: state.sizeTab }],
  };
}

/** size 단계에서 사용자가 탭을 손으로 바꿀 때 — 이력을 바꾸지 않는다(같은 단계). */
export function stateSwitchSizeTab(state: FitFlowState, tab: SizeTab): FitFlowState {
  return { ...state, sizeTab: tab };
}
