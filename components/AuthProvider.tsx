"use client";

/**
 * [인증 컨텍스트] 로그인 상태 + 스마트핏 프로필 전역 관리
 * - localStorage: n1_auth_token / n1_fit_profile (새로고침 유지)
 * - 로그인 시 서버 프로필 우선, 비로그인 시 localStorage 프로필 사용
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export interface FitProfile { gender: string; size: string; fit: string; }
interface AuthState {
  token: string | null;
  email: string | null;
  profile: FitProfile | null;
  login: (token: string, email: string, profile: FitProfile) => void;
  logout: () => void;
  updateProfile: (p: FitProfile) => void;
  ready: boolean;
}

const AuthCtx = createContext<AuthState>({
  token: null, email: null, profile: null,
  login: () => {}, logout: () => {}, updateProfile: () => {}, ready: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<FitProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("n1_auth_token");
    const e = localStorage.getItem("n1_auth_email");
    const raw = localStorage.getItem("n1_fit_profile");
    if (t && e) { setToken(t); setEmail(e); }
    if (raw) { try { setProfile(JSON.parse(raw)); } catch {} }
    setReady(true);
  }, []);

  const login = (tk: string, em: string, p: FitProfile) => {
    setToken(tk); setEmail(em); setProfile(p);
    localStorage.setItem("n1_auth_token", tk);
    localStorage.setItem("n1_auth_email", em);
    localStorage.setItem("n1_fit_profile", JSON.stringify(p));
  };

  const logout = () => {
    setToken(null); setEmail(null); setProfile(null);
    localStorage.removeItem("n1_auth_token");
    localStorage.removeItem("n1_auth_email");
    localStorage.removeItem("n1_fit_profile");
  };

  const updateProfile = (p: FitProfile) => {
    setProfile(p);
    localStorage.setItem("n1_fit_profile", JSON.stringify(p));
    if (token) {
      fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", token, profile: p }),
      }).catch(() => {});
    }
  };

  return <AuthCtx.Provider value={{ token, email, profile, login, logout, updateProfile, ready }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
