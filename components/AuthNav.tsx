"use client";

/**
 * [헤더 네비] 로그인/회원가입 + 로그인 상태 표시 + 회원가입 모달(2단계)
 */
import { useState } from "react";
import { useAuth, FitProfile } from "./AuthProvider";

export default function AuthNav() {
  const { token, email, profile, login, logout, updateProfile } = useAuth();
  const [modal, setModal] = useState<null | "register" | "login">(null);
  const [step, setStep] = useState(1);
  const [regEmail, setRegEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [gender, setGender] = useState("");
  const [size, setSize] = useState("");
  const [fit, setFit] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const TOP = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
  const BOTTOM = ["28~29", "30~31", "32~33", "34~35", "FREE"];

  const doRegister = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", email: regEmail, password: pw, profile: { gender, size: size.replace(/\(.*\)/, ""), fit } }),
      });
      const data = await res.json();
      if (data.ok) { login(data.token, regEmail, data.profile); setModal(null); }
      else setErr(data.error);
    } catch { setErr("서버 오류"); } finally { setBusy(false); }
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

  const fitLabel = profile ? `${profile.size} · ${{A: "정핏", B: "세미오버", C: "오버핏"}[profile.fit as "A"|"B"|"C"] || profile.fit}` : "";

  return (
    <>
      <div className="auth-nav">
        {token && email ? (
          <>
            <span className="auth-user">{email.split("@")[0]}님{profile && ` (${fitLabel})`} ⚙️</span>
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
                <button className="fit-next" disabled={busy || !email || !pw || pw !== pw2}
                  onClick={() => { if (pw.length < 6) { setErr("비밀번호는 6자 이상"); return; } setErr(""); setStep(2); }}>
                  다음 → 스마트핏 설정
                </button>
              </>
            )}

            {modal === "register" && step === 2 && (
              <>
                <h3 className="fit-q">2단계 — 스마트 핏 프로필</h3>
                <p className="fit-progress">Q1. 성별</p>
                <div className="fit-opts">
                  {["남성", "여성"].map((g) => (
                    <button key={g} className={`fit-opt ${gender === g ? "selected" : ""}`} onClick={() => setGender(g)}>{g}</button>
                  ))}
                </div>
                <p className="fit-progress">Q2. 기준 체형</p>
                <div className="fit-opts">
                  {(gender === "여성" ? BOTTOM : TOP).map((s) => (
                    <button key={s} className={`fit-opt ${size === s ? "selected" : ""}`} onClick={() => setSize(s)}>{s}</button>
                  ))}
                </div>
                <p className="fit-progress">Q3. 선호 실루엣</p>
                <div className="fit-opts fit-vertical">
                  {[
                    { v: "A", t: "정핏", d: "딱 맞는 정사이즈" },
                    { v: "B", t: "세미오버 (기본) ⭐", d: "자켓은 1치수 여유" },
                    { v: "C", t: "오버핏", d: "박시하고 넉넉하게" },
                  ].map((o) => (
                    <button key={o.v} className={`fit-opt-v ${fit === o.v ? "selected" : ""}`} onClick={() => setFit(o.v)}>
                      <b>{o.t}</b><span>{o.d}</span>
                    </button>
                  ))}
                </div>
                {err && <p className="stock-alert">{err}</p>}
                <button className="fit-next" disabled={busy || !gender || !size || !fit} onClick={doRegister}>
                  {busy ? "처리 중..." : "가입 완료 — 자동 사이즈 추천 시작"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
