"use client";

/**
 * [인증 컨텍스트] 로그인 상태 + 스마트 핏 컨텍스트(Fit Context V2) 전역 관리
 * - localStorage: n1_auth_token / n1_auth_email / n1_fit_profile (새로고침 유지)
 * - Fit Context는 게스트 즉시 저장(§8) — 로그인 없이도 탐색 내내 유지(§9)
 * - 로그인 병합: 서버에 이 계정의 핏이 있으면 서버가 우선, 없으면 게스트
 *   컨텍스트가 살아남아 계정으로 승격된다(§11 — 로그인이 상태를 파괴하지 않음)
 * - 로그아웃 시 인증 토큰만 제거 — 핏 컨텍스트는 기기 로컬 기억으로 유지,
 *   전면 초기화는 스마트 핏의 '초기화'로만 가능(§27: 숨은 상태 잔존 금지)
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  type FitContext,
  clearFitContext,
  isFitContextUsable,
  loadFitContext,
  mergeOnLogin,
  saveFitContext,
  encodeProfileForServer,
} from "@/lib/fitContext";

interface AuthState {
  token: string | null;
  email: string | null;
  fit: FitContext | null; // Fit Context V2 — 게스트/로그인 공용 단일 진실
  login: (token: string, email: string, serverProfile?: unknown) => void;
  logout: () => void;
  saveFit: (ctx: FitContext) => void;
  resetFit: () => void;
  ready: boolean;
}

const AuthCtx = createContext<AuthState>({
  token: null, email: null, fit: null,
  login: () => {}, logout: () => {}, saveFit: () => {}, resetFit: () => {}, ready: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [fit, setFit] = useState<FitContext | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("n1_auth_token");
    const e = localStorage.getItem("n1_auth_email");
    if (t && e) { setToken(t); setEmail(e); }
    setFit(loadFitContext()); // v1 프로필이면 v2 컨텍스트로 자동 마이그레이션
    setReady(true);
  }, []);

  const syncProfileToServer = (tk: string, ctx: FitContext) => {
    fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "profile", token: tk, profile: encodeProfileForServer(ctx) }),
    }).catch(() => {});
  };

  const login = (tk: string, em: string, serverProfile?: unknown) => {
    setToken(tk); setEmail(em);
    localStorage.setItem("n1_auth_token", tk);
    localStorage.setItem("n1_auth_email", em);
    // §11 — 게스트가 방금 만든 컨텍스트가 로그인 후에도 유지되도록 병합한다.
    const { ctx, syncToServer } = mergeOnLogin(serverProfile, loadFitContext());
    if (ctx) {
      setFit(ctx);
      saveFitContext(ctx);
      if (syncToServer) syncProfileToServer(tk, ctx);
    }
  };

  const logout = () => {
    setToken(null); setEmail(null);
    localStorage.removeItem("n1_auth_token");
    localStorage.removeItem("n1_auth_email");
    // 핏 컨텍스트는 유지 — 다음 로그인에서 병합 정책이 계정 기억과 합친다.
  };

  const saveFit = (ctx: FitContext) => {
    setFit(ctx);
    saveFitContext(ctx);
    if (token) syncProfileToServer(token, ctx); // 로그인 사용자 → Users 시트에도 반영
  };

  const resetFit = () => {
    setFit(null);
    clearFitContext();
  };

  return <AuthCtx.Provider value={{ token, email, fit, login, logout, saveFit, resetFit, ready }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** 편의: 컨텍스트가 결과 도출에 쓸 수 있는 상태인지 */
export const useFitUsable = () => isFitContextUsable(useContext(AuthCtx).fit);
