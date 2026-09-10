"use client";

/**
 * [인증 컨텍스트] 로그인 상태 + 스마트 핏 컨텍스트(Fit Context V2) 전역 관리
 * (Session A — AUTH + SMART FIT 기반, 2026-09-09)
 *
 * 저장 경계 (Session A §6·§7·§8·§9):
 *  - 게스트: n1_fit_profile → sessionStorage에만. 서버/Customer Sheet에는 쓰지
 *    않고, 새 탭·재방문에도 남지 않는다. 탭 세션 안에서는 PDP 이동·새로고침·
 *    카트 이동에도 유지된다.
 *  - 회원: n1_fit_profile → localStorage(기기 기억) + /api/auth profile 액션
 *    (Users 시트 — authorized profile storage). 로그인 세션마다 localStorage
 *    슬롯은 활성 계정으로 다시 묶인다(계정 간 누수 없음).
 *  - 승격: 게스트가 만든 컨텍스트는 로그인 성공 시 localStorage로 옮겨지고
 *    sessionStorage 사본은 지워진다 → 회원가입 후 Smart Fit을 다시 묻지 않는다.
 *    이어서 서버 readback으로 "보여주는 값 = 저장된 값"을 확인한다(§8).
 *  - 로그아웃: 인증 토큰만 제거. localStorage 핏은 마지막 계정의 기기 기억으로
 *    유지되지만 게스트는 읽지 않으므로 새 세션에 노출되지 않는다.
 *  - reset: 로컬 저장소 + (회원이면) 서버 핏 필드 공백화까지 — 숨은 상태 잔존 금지.
 *
 * Session J — PERSONALIZATION FULL INTEGRATION (2026-09-09):
 *  - logout이 화면 상태(fit)도 게스트 세션 컨텍스트로 되돌린다 — 로그아웃 직후의
 *    게스트에게 마지막 계정의 핏이 개인화로 보이는 것을 막는다(member returning의
 *    전제: 재로그인 시 login 병합으로 계정 핏이 복원되어 Pair/PDP에 즉시 적용).
 *  - login에서 이 계정에도 게스트 세션에도 핏이 없으면 기기 슬롯을 비운다 —
 *    이전 계정의 기기 핏이 새 계정으로 새어들지 않도록 슬롯을 활성 계정에 재바인딩.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  type FitContext,
  RESET_FIT_PROFILE_FLAG,
  clearFitContext,
  isFitContextUsable,
  loadGuestFitContext,
  loadMemberFitContext,
  mergeOnLogin,
  promoteGuestFitToMember,
  saveFitContext,
  encodeProfileForServer,
} from "@/lib/fitContext";

interface AuthState {
  token: string | null;
  email: string | null;
  username: string | null;
  /** 이메일 인증 대기(신규 정책의 미인증 계정) — 서버 응답의 verificationRequired만 반영한다 */
  pending: boolean;
  fit: FitContext | null; // Fit Context V2 — 게스트/회원 공용 단일 진실
  login: (token: string, email: string, serverProfile?: unknown, username?: string | null, pending?: boolean) => void;
  setPending: (pending: boolean) => void;
  logout: () => void;
  saveFit: (ctx: FitContext) => void;
  resetFit: () => void;
  ready: boolean;
}

const AuthCtx = createContext<AuthState>({
  token: null, email: null, username: null, pending: false, fit: null,
  login: () => {}, setPending: () => {}, logout: () => {}, saveFit: () => {}, resetFit: () => {}, ready: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [pending, setPendingState] = useState(false);
  const [fit, setFit] = useState<FitContext | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("n1_auth_token");
    const e = localStorage.getItem("n1_auth_email");
    const u = localStorage.getItem("n1_auth_username");
    if (t && e) {
      setToken(t); setEmail(e); setUsername(u);
      // 대기 플래그는 localStorage가 아니라 서버 readback으로만 확정한다 —
      // 클라이언트 저장값은 참고용으로 시작하고, 응답이 진실로 덮어쓴다.
      fetch(`/api/auth?token=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.ok) setPendingState(Boolean(d.verificationRequired) && !d.emailVerified); })
        .catch(() => {});
    }
    // 회원이면 기기 슬롯(localStorage)에서, 게스트면 세션 저장소에서만 읽는다 —
    // 게스트에게 이전 회원/이전 세션의 영구 데이터는 보이지 않는다(§6·§9).
    setFit(t && e ? loadMemberFitContext() : loadGuestFitContext());
    setReady(true);
  }, []);

  /** 회원 프로필 서버 반영(Users 시트) — 실패는 조용히: 기기 상태가 진실이다. */
  const syncProfileToServer = (tk: string, ctx: FitContext) => {
    fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "profile", token: tk, profile: encodeProfileForServer(ctx) }),
    }).catch(() => {});
  };

  /** §8 readback — 서버에 실제 저장된 프로필을 읽어 화면 값과 일치시킨다. */
  const readbackProfile = async (tk: string): Promise<unknown> => {
    try {
      const res = await fetch(`/api/auth?token=${encodeURIComponent(tk)}`);
      const data = await res.json();
      return data.ok ? data.profile : null;
    } catch {
      return null;
    }
  };

  const login = (tk: string, em: string, serverProfile?: unknown, un?: string | null, pending?: boolean) => {
    setToken(tk); setEmail(em); setUsername(un ?? null);
    // 인증 필수 정책 — 서버가 판정한 대기 상태만 반영한다(클라이언트 제출값 무관)
    setPendingState(Boolean(pending));
    localStorage.setItem("n1_auth_token", tk);
    localStorage.setItem("n1_auth_email", em);
    if (un) localStorage.setItem("n1_auth_username", un);
    else localStorage.removeItem("n1_auth_username");

    // §11 — 게스트가 방금 만든 컨텍스트가 로그인 후에도 유지되도록 병합한다.
    const guestCtx = loadGuestFitContext();
    const { ctx, syncToServer } = mergeOnLogin(serverProfile, guestCtx);
    if (ctx) {
      // 승격: 세션 사본 → 기기 슬롯. 로그인 성공마다 슬롯을 활성 계정으로 다시
      // 묶으므로 이전 계정의 기기 데이터가 새 계정에 흐르지 않는다.
      const promoted = promoteGuestFitToMember(ctx);
      setFit(promoted);
      if (syncToServer) syncProfileToServer(tk, promoted);
      else void readbackProfile(tk).then((profile) => {
        // 서버가 이긴 경우(mergeOnLogin에서 서버 값을 이미 채택) — 저장값과 일치 확인.
        // readback이 실패하면 기기 병합 값을 유지한다(서비스 지속 우선).
        const merged = mergeOnLogin(profile, promoted);
        if (merged.ctx) setFit(merged.ctx);
      });
    } else {
      // 이 계정에도(서버) 게스트 세션에도 핏이 없다 — 기기 슬롯에 남아 있을 수 있는
      // 이전 계정의 핏을 지워 슬롯을 활성 계정에 다시 묶는다(계정 간 누수 없음,
      // [SESSION J] 재로그인 시 삭제된 핏이 되살아나지 않는다).
      clearFitContext(localStorage);
      setFit(null);
    }
  };

  const logout = () => {
    setToken(null); setEmail(null); setUsername(null); setPendingState(false);
    localStorage.removeItem("n1_auth_token");
    localStorage.removeItem("n1_auth_email");
    localStorage.removeItem("n1_auth_username");
    // 핏 컨텍스트(localStorage)는 마지막 계정의 기기 기억으로 유지 — 게스트는
    // sessionStorage만 읽으므로 노출되지 않는다. 다음 로그인에서 병합 정책이 적용된다.
    // [SESSION J — member returning] 화면 상태도 게스트 경계로 되돌린다: 로그아웃
    // 직후의 게스트에게 마지막 계정의 핏이 개인화로 보이지 않게 하고, 재로그인 시
    // 서버 프로필 병합(login)으로 계정 핏이 복원·즉시 적용된다.
    setFit(loadGuestFitContext());
  };

  const saveFit = (ctx: FitContext) => {
    setFit(ctx);
    if (token) {
      saveFitContext(ctx, localStorage); // 회원 — 기기 슬롯 + 서버(Users 시트)
      syncProfileToServer(token, ctx);
    } else {
      saveFitContext(ctx, sessionStorage); // 게스트 — 세션 경계 안에만(§6, 서버 호출 없음)
    }
  };

  /** §9 reset — 로컬 + 서버까지 지운다(회원). 숨은 상태 잔존 금지. */
  const resetFit = () => {
    setFit(null);
    clearFitContext(localStorage);
    clearFitContext(sessionStorage);
    if (token) {
      fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", token, [RESET_FIT_PROFILE_FLAG]: true }),
      }).catch(() => {});
    }
  };

  /** 인증 완료(verify 링크 통과) 후 화면 상태를 즉시 해제 — readback 없이도 정직한 표시 */
  const setPending = (p: boolean) => setPendingState(p);

  return (
    <AuthCtx.Provider
      value={{ token, email, username, pending, fit, login, setPending, logout, saveFit, resetFit, ready }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

/** 편의: 컨텍스트가 결과 도출에 쓸 수 있는 상태인지 */
export const useFitUsable = () => isFitContextUsable(useContext(AuthCtx).fit);
