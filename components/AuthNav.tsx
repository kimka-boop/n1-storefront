"use client";

/**
 * [헤더 네비] 로그인/회원가입 + 로그인 상태 표시 + 회원가입 모달(2단계)
 */
import { useEffect, useState } from "react";
import { useAuth, FitProfile } from "./AuthProvider";
import SmartFitFlow from "./SmartFitFlow";

export default function AuthNav({ onOpenSmartFit }: { onOpenSmartFit?: () => void } = {}) {
  const { token, email, profile, login, logout, updateProfile } = useAuth();
  const [modal, setModal] = useState<null | "register" | "login">(null);
  const [step, setStep] = useState(1);
  const [regEmail, setRegEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasFitProfile, setHasFitProfile] = useState(false);
  const [pendingCreds, setPendingCreds] = useState<{ email: string; password: string } | null>(null);
  const [showSF, setShowSF] = useState(false); // 회원가입 → SmartFitFlow
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem("n1_fit_profile") || "null"); setHasFitProfile(!!p?.gender); } catch {}
  }, [modal]);

  const TOP = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
  const BOTTOM = ["28~29", "30~31", "32~33", "34~35", "FREE"];

  const doRegister = async () => {
    // 계정 정보만 확인 후 SmartFitFlow로 — Smart Fit 없는 가입 경로 제거
    if (pw.length < 6) { setErr("비밀번호는 6자 이상"); return; }
    // 계정 정보를 메모리에 보관(로컬스토리지/URL 저장 금지)하고 Smart Fit 시작
    setPendingCreds({ email: regEmail, password: pw });
    setModal(null);
    setShowSF(true);
  };

  const doLogin = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: regEmail, password: pw }),
      });
      const data = await res.json();
      if (data.ok) { login(data.token, regEmail, data.profile); setModal(null); }
      else setErr(data.error);
    } catch { setErr("서버 오류"); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="auth-nav">
        {token && email ? (
          <>
            <span className="auth-user">{email.split("@")[0]}님</span>
            <button className="auth-link" onClick={logout}>로그아웃</button>
          </>
        ) : (
          <>
            <button className="auth-link" onClick={() => { setModal("login"); setStep(1); setErr(""); }}>로그인</button>
            <button className="auth-link primary" onClick={() => { setModal("register"); setStep(1); setErr(""); }}>회원가입</button>
          </>
        )}
      </div>

      {modal && (
        <div className="fit-modal-bg" onClick={() => setModal(null)}>
          <div className="fit-modal" onClick={(e) => e.stopPropagation()}>
            <button className="fit-close" onClick={() => setModal(null)}>✕</button>
            <p className="fit-progress">{modal === "register" ? "회원가입 (2단계)" : "로그인"}</p>

            {modal === "login" && (
              <>
                <h3 className="fit-q">로그인</h3>
                <input className="order-input" placeholder="이메일" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                <input className="order-input" placeholder="비밀번호" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
                {err && <p className="stock-alert">{err}</p>}
                <button className="fit-next" disabled={busy || !regEmail || !pw} onClick={doLogin}>로그인</button>
                <p className="fit-alt">계정이 없으신가요? <button onClick={() => { setModal("register"); setStep(1); }}>회원가입</button></p>
              </>
            )}

            {modal === "register" && step === 1 && (
              <>
                <h3 className="fit-q">1단계 — 계정 생성</h3>
                <input className="order-input" placeholder="이메일" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                <input className="order-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <input className="order-input" placeholder="비밀번호 확인" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                {err && <p className="stock-alert">{err}</p>}
                <button className="fit-next" disabled={busy || !regEmail || !pw || pw !== pw2}
                  onClick={doRegister}>
                  {busy ? "확인 중…" : "다음 — Smart Fit 설정 →"}
                </button>
                <p className="fit-alt">다음 단계에서 Smart Fit(3문항)을 설정하면 가입이 완료됩니다.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 회원가입 → Smart Fit 강제 연결 (FLOW B) */}
      {showSF && pendingCreds && (
        <SmartFitFlow
          initial={null}
          isLoggedIn={false}
          userEmail={pendingCreds.email}
          pendingCredentials={pendingCreds}
          onSave={() => {}}
          onRegister={async (email, pw, profile) => {
            const res = await fetch("/api/auth", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "register", email, password: pw, profile }),
            });
            return res.json();
          }}
          onRegistered={(token, email, profile) => {
            login(token, email, profile);
            setShowSF(false);
            setPendingCreds(null);
          }}
          onClose={() => { setShowSF(false); setPendingCreds(null); }}
        />
      )}
    </>
  );
}
