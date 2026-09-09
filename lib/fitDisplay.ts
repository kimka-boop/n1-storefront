/**
 * N°1 — 개인화 표시 계층 (SESSION J — PERSONALIZATION FULL INTEGRATION, 2026-09-09)
 *
 * TASK 9  — PDP "Your fit"의 사용자 컨텍스트 문구: 기존 "내 설정 — 정핏 선호 · 평소
 *   상의 105" 접두사 형태를 폐기하고, 라벨 "내가 설정한 치수" + 값 두 줄로 분리한다.
 *   값 자체는 lib/fit.ts interpretFit의 yourContext("정핏 선호 · 평소 상의 105")를
 *   그대로 쓴다 — 새 문구 창작 없음, 라벨만 분리.
 *
 * TASKS 27·28 — Pair × Smart Fit: E의 사전 계산 pair mapping(프론트 계약 CatalogPair)의
 *   top/bottom 상품을 같은 User Fit Context로 **각각** 해석한다.
 *   - Top A → result A, Bottom B → result B (같은 ctx, 상품별 해석).
 *   - 페어 전체에 하나의 사이즈를 추천하는 표현은 존재하지 않는다 — 이 모듈은
 *     슬롯(top/bottom)별 해석만 내보내고 pair-level 단일 사이즈 함수는 제공하지 않는다.
 *   - 근거 없는 exact recommendation 금지: 표시 라인은 interpretFit의 방향 해석
 *     (실루엣 비교)과 사용자가 알려준 컨텍스트만 담는다. 정밀 사이즈 안내(sizeHint)는
 *     PDP의 4층 해석에서만(근거 READY일 때만) 노출되며 pair 카드 라인에는 없다.
 *   - NO LLM ON PAGEVIEW(N1_PAIRING_POLICY_V1 §11): 페이지뷰 시점 계산은 순수 함수
 *     interpretFit뿐 — 페어 조합·스코어는 서버가 내려준 mapping만 읽는다.
 */
import { interpretFit, type FitInterpretation, type FitProductInput } from "./fit";
import type { FitContext } from "./fitContext";

/** TASK 9 — PDP Your fit 컨텍스트 라벨 (값은 interpretFit.yourContext) */
export const MY_DIMENSIONS_LABEL = "내가 설정한 치수";

export interface PairFitView {
  slot: "top" | "bottom";
  interpretation: FitInterpretation | null; // 컨텍스트가 없으면 null — 개인화 자체가 없다
}

/**
 * 같은 User Fit Context로 페어의 상·하의를 각각 해석한다 (TASK 27).
 * 반환값은 슬롯별 뷰 2개뿐 — 페어 단위 통합 사이즈 뷰는 만들지 않는다.
 */
export function pairFitViews(
  top: FitProductInput,
  bottom: FitProductInput,
  ctx: FitContext | null | undefined,
): { top: PairFitView; bottom: PairFitView } {
  return {
    top: { slot: "top", interpretation: interpretFit(top, ctx) },
    bottom: { slot: "bottom", interpretation: interpretFit(bottom, ctx) },
  };
}

/**
 * Pair row/PDP 함께 보기용 조용한 개인화 라인 (TASK 28).
 * "{yourContext} — {interpretation}" — 예: "정핏 선호 · 평소 상의 105 — 선호하시는
 * 방향과 가까운 실루엣이에요."
 * 해석이 없거나(컨텍스트 없음) 핏 규칙 대상 밖(소품, UNAVAILABLE)이면 빈 문자열 —
 * 카드는 조용히 개인화 없는 상태로 돌아간다.
 */
export function pairFitLine(interp: FitInterpretation | null | undefined): string {
  if (!interp || interp.evidence === "UNAVAILABLE") return "";
  return `${interp.yourContext} — ${interp.interpretation}`;
}
