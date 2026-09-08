/**
 * N°1 Smart Fit V2 — FIT CONTEXT (2026-09-09, Smart Fit V2 미션)
 *
 * Fit Context = 사용자가 알려준 최소 핏 취향. "ASK ONLY WHAT MATERIALLY
 * IMPROVES THE RESULT" — 선호 핏은 필수, 평소 사이즈는 카테고리별로 점진 수집.
 * 성별은 어떤 판단에도 쓰이지 않아 V2 질문에서 제거했다(레거시 값만 보존).
 *
 * 저장:
 *  - localStorage "n1_fit_profile" (v1 객체는 자동 마이그레이션)
 *  - 로그인 시에만 /api/auth profile 액션으로 서버 동기화 — 기존 Users 시트
 *    계약({gender,size,fit})을 유지하기 위해 encodeProfileForServer로 직렬화.
 *    기존 "기준사이즈" 컬럼 하나에 상·하의를 "상의 100 · 하의 30~31" 형태로
 *    담는다(스키마 변경 없음 — CURRENT LIMITATION은 최종 보고에 기재).
 *
 * 로그인 병합 원칙: 서버에 이 계정의 핏이 있으면 서버가 이긴다(계정 기억).
 * 서버가 비어 있으면 게스트가 방금 만든 컨텍스트가 살아남고 서버로 승격된다.
 */
export type PreferredFit = "A" | "B" | "C";

export interface FitContext {
  v: 2;
  preferredFit: PreferredFit;
  topSize?: string; // 평소 상의 사이즈 앵커 — 예: "100", "M", "FREE"
  bottomSize?: string; // 평소 하의 사이즈 앵커 — 예: "30~31"
  gender?: string; // 레거시(v1) 보존용 — V2에서는 질문하지 않는다
  updatedAt?: string;
}

export const FIT_STORAGE_KEY = "n1_fit_profile";
export const FIT_GENDER_PLACEHOLDER = "미지정";

const FIT_VALUES: PreferredFit[] = ["A", "B", "C"];

/** v1({gender,size,fit}) · v2 객체 모두 수용. 판별 불가는 null — 추측 금지. */
export function migrateFitContext(raw: unknown): FitContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawFit =
    typeof o.preferredFit === "string"
      ? o.preferredFit.trim().toUpperCase()
      : typeof o.fit === "string"
        ? o.fit.trim().toUpperCase()
        : "";
  if (!(FIT_VALUES as readonly string[]).includes(rawFit)) return null;
  const ctx: FitContext = { v: 2, preferredFit: rawFit as PreferredFit };
  if (typeof o.topSize === "string" && o.topSize.trim()) ctx.topSize = o.topSize.trim();
  if (typeof o.bottomSize === "string" && o.bottomSize.trim()) ctx.bottomSize = o.bottomSize.trim();
  if (!ctx.topSize && typeof o.size === "string" && o.size.trim()) {
    // v1 단일 사이즈는 상의 앵커로 승계 (v1이 상·하의를 구분하지 않았던 한계 승인)
    ctx.topSize = o.size.trim();
  }
  if (typeof o.gender === "string" && o.gender.trim() && o.gender !== FIT_GENDER_PLACEHOLDER) {
    ctx.gender = o.gender.trim();
  }
  return ctx;
}

/** 선호 핏만 있어도 방향 해석은 가능 — 사이즈는 점진 보강. */
export function isFitContextUsable(ctx: FitContext | null | undefined): ctx is FitContext {
  return Boolean(ctx && ctx.preferredFit);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadFitContext(storage: Pick<Storage, "getItem"> = safeStorage() as Storage): FitContext | null {
  try {
    const raw = storage?.getItem(FIT_STORAGE_KEY);
    return raw ? migrateFitContext(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveFitContext(ctx: FitContext, storage: Pick<Storage, "setItem"> = safeStorage() as Storage): void {
  try {
    storage?.setItem(FIT_STORAGE_KEY, JSON.stringify({ ...ctx, v: 2 as const, updatedAt: new Date().toISOString() }));
  } catch {}
}

export function clearFitContext(storage: Pick<Storage, "removeItem"> = safeStorage() as Storage): void {
  try {
    storage?.removeItem(FIT_STORAGE_KEY);
  } catch {}
}

/* ────────────────────────────────────────────────────────────
 * 서버 직렬화 — /api/auth 계약 {gender, size, fit} 유지.
 * 시트 "기준사이즈" 하나에 상·하의를 합성 문자열로 보관(스키마 변경 없음).
 * ──────────────────────────────────────────────────────────── */

export function encodeProfileForServer(ctx: FitContext): { gender: string; size: string; fit: string } {
  const parts: string[] = [];
  if (ctx.topSize) parts.push(`상의 ${ctx.topSize}`);
  if (ctx.bottomSize) parts.push(`하의 ${ctx.bottomSize}`);
  return {
    gender: ctx.gender || FIT_GENDER_PLACEHOLDER,
    size: parts.join(" · "),
    fit: ctx.preferredFit,
  };
}

export function parseServerProfile(
  p: { gender?: unknown; size?: unknown; fit?: unknown } | null | undefined,
): FitContext | null {
  if (!p || typeof p !== "object") return null;
  // 합성 문자열("상의 100 · 하의 30~31") 분해 — 구버전 단일 값은 상의 앵커로 승계
  const rawSize = typeof p.size === "string" ? p.size.trim() : "";
  const top = rawSize.match(/상의\s*([^·]+)/)?.[1]?.trim();
  const bottom = rawSize.match(/하의\s*([^·]+)/)?.[1]?.trim();
  const plain = !top && !bottom ? rawSize || undefined : undefined;
  return migrateFitContext({
    preferredFit: typeof p.fit === "string" ? p.fit : undefined,
    topSize: top || plain,
    bottomSize: bottom || undefined,
    gender: typeof p.gender === "string" ? p.gender : undefined,
  });
}

export interface LoginMergeResult {
  ctx: FitContext | null; // 로그인 후 유지할 컨텍스트
  syncToServer: boolean; // 서버에 없던 로컬 컨텍스트를 승격해야 하는가
}

/**
 * 로그인 시 컨텍스트 병합 (§11 — 로그인이 Smart Fit 상태를 파괴하지 않는다).
 * - 서버에 핏이 있으면 계정 기억이 이긴다(다른 기기에서 온 값 존중).
 * - 서버가 비어 있으면 게스트 컨텍스트가 살아남고 서버로 승격된다.
 * - 로그인 실패/취소는 이 함수를 거치지 않으므로 로컬 상태가 그대로다(§35 CASE 15).
 */
export function mergeOnLogin(serverProfile: unknown, localCtx: FitContext | null): LoginMergeResult {
  const server = parseServerProfile(serverProfile);
  if (server) return { ctx: server, syncToServer: false };
  return { ctx: localCtx, syncToServer: isFitContextUsable(localCtx) };
}
