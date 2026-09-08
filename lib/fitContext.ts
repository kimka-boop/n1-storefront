/**
 * N°1 Smart Fit V2 — FIT CONTEXT (2026-09-09, Session A: Auth + Smart Fit 기반)
 *
 * Fit Context = 사용자가 알려준 최소 핏 취향. "ASK ONLY WHAT MATERIALLY
 * IMPROVES THE RESULT" — 선호 핏은 필수, 평소 사이즈는 카테고리별로 점진 수집.
 * 성별은 어떤 판단에도 쓰이지 않아 V2 질문에서 제거했다(레거시 값만 보존).
 *
 * 저장 정책 (Session A §6·§7·§8·§9):
 *  - 게스트: sessionStorage에만 저장한다 — 탭 세션이 살아 있는 동안 PDP 이동·
 *    새로고침·카트 이동에도 유지되고, 탭이 닫히면 사라진다. 영구 저장소
 *    (localStorage)와 서버/Customer Sheet에는 절대 쓰지 않는다.
 *  - 회원: localStorage(기기 기억) + /api/auth profile 액션(Users 시트)에 저장.
 *    기존 Users 시트 계약({gender,size,fit})을 유지하기 위해 encodeProfileForServer로
 *    직렬화한다. 기존 "기준사이즈" 컬럼 하나에 상·하의를 "상의 100 · 하의 30~31"
 *    형태로 담는다(스키마 변경 없음 — CURRENT LIMITATION은 최종 보고에 기재).
 *  - 로그인 승격: 게스트가 만든 컨텍스트는 로그인 성공 시 localStorage 슬롯으로
 *    옮겨지고(계정 기억), sessionStorage 사본은 지워진다(promoteGuestFitToMember).
 *    로그인이 성공할 때마다 localStorage 슬롯은 활성 계정의 컨텍스트로 다시 묶이므로
 *    계정 간 누수가 없다.
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

/* ────────────────────────────────────────────────────────────
 * 저장소 선택 — 게스트는 세션 경계 안에서만, 회원은 기기+서버까지.
 * §6: Guest Fit Context는 persistent Customer Sheet에 쓰지 않는다.
 * §9: 회원은 쇼핑 개인화 목적으로만 저장하고 view/edit/reset이 가능하다.
 * ──────────────────────────────────────────────────────────── */

function tryStorage(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** 회원 기기 슬롯 — 로그인 세션마다 활성 계정의 컨텍스트로 다시 묶인다. */
export function memberStorage(): Storage | null {
  return tryStorage("local");
}

/** 게스트 세션 저장소 — 탭 세션 경계. 새 탭/재방문에는 남지 않는다. */
export function guestStorage(): Storage | null {
  return tryStorage("session");
}

/** 회원 저장 경로 — localStorage(기기 기억). 서버 반영은 AuthProvider가 담당. */
export function saveMemberFitContext(
  ctx: FitContext,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = memberStorage(),
): void {
  saveFitContext(ctx, storage);
}

export function loadMemberFitContext(
  storage: Pick<Storage, "getItem"> | null = memberStorage(),
): FitContext | null {
  return loadFitContext(storage);
}

/** 게스트 저장 경로 — sessionStorage. 절대 localStorage/서버로 가지 않는다(§6). */
export function saveGuestFitContext(
  ctx: FitContext,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = guestStorage(),
): void {
  saveFitContext(ctx, storage);
}

export function loadGuestFitContext(
  storage: Pick<Storage, "getItem"> | null = guestStorage(),
): FitContext | null {
  return loadFitContext(storage);
}

/**
 * 게스트 → 회원 승격 (§8): 로그인 병합이 고른 컨텍스트를 회원 기기 슬롯에
 * 기록하고 게스트 세션 사본은 지운다. ctx는 mergeOnLogin의 결과값이다 —
 * 서버가 이겼으면 서버 값(세션 사본으로 슬롯을 덮지 않는다), 승격이면
 * 게스트가 방금 만든 값이다. 서버 동기화는 AuthProvider가 담당한다.
 */
export function promoteGuestFitToMember(
  ctx: FitContext,
  fromSession: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = guestStorage(),
  toMember: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = memberStorage(),
): FitContext {
  saveFitContext(ctx, toMember);
  fromSession?.removeItem(FIT_STORAGE_KEY); // 게스트 임시 사본 정리
  return ctx;
}

/* ── 범용 저장 함수들 — 저장소를 주입받는다(테스트 격리). ── */

export function loadFitContext(storage: Pick<Storage, "getItem"> | null): FitContext | null {
  try {
    const raw = storage?.getItem(FIT_STORAGE_KEY);
    return raw ? migrateFitContext(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveFitContext(ctx: FitContext, storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(FIT_STORAGE_KEY, JSON.stringify({ ...ctx, v: 2 as const, updatedAt: new Date().toISOString() }));
  } catch {}
}

export function clearFitContext(storage: Pick<Storage, "removeItem"> | null): void {
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

/**
 * §9 reset 권리 — 회원의 서버 프로필 초기화 플래그.
 * 프로필 액션에 resetFitProfile=true로 보내면 서버가 핏 필드를 공백화한다.
 */
export const RESET_FIT_PROFILE_FLAG = "resetFitProfile" as const;
