"use client";
/**
 * N°1 — Product Detail Scroll Interaction Prototype (STEP 1)
 *
 * SCROLL = PRODUCT EXPLORATION
 *  - 4각도(FRONT→45→90→BACK)를 sticky 비주얼 위에 crossfade로 연결
 *  - 스크롤 진행도 = 카메라 궤도. 슬라이드쇼 버튼 없음
 *  - 이미지 로딩: FRONT 즉시 → 45 preload → 90/BACK 지연 (동시 다운로드 회피)
 *  - LOW DATA / prefers-reduced-motion → 기존 슬라이드 방식 폴백
 *
 * 기존 .modal 상세 UI는 그대로 보존 — feature flag(prototypeEnabled)로 진입점만 분리.
 */

export const PROTO_ANGLES = [
  { order: "01", type: "AI_MODEL_FRONT", label: "FRONT", kr: "정면" },
  { order: "02", type: "AI_MODEL_45DEG", label: "45°", kr: "사선" },
  { order: "03", type: "AI_MODEL_90DEG", label: "90°", kr: "측면" },
  { order: "04", type: "AI_MODEL_BACK", label: "BACK", kr: "후면" },
] as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isLowData(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("n1_lowdata") === "1";
}
