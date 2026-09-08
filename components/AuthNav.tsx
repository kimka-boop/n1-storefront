"use client";

/**
 * [헤더 네비] 로그인/회원가입 + 로그인 상태 표시 + 회원가입 모달(2단계)
 * 회원가입 2단계 — 게스트가 이미 만든 핏 프로필(n1_fit_profile)이 있으면
 * 다시 묻지 않고 그 프로필로 바로 가입할 수 있다 (질문 무반복 원칙).
 */
import { useEffect, useState } from "react";
import { useAuth, FitProfile } from "./AuthProvider";
import LiquidSurface from "./LiquidSurface";
import LqSeg from "./LqSeg";

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
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  // 게스트가 이미 만든 핏 프로필 — 회원가입 2단계에서 재질문하지 않고 재사용
  const [savedFit, setSavedFit] = useState<FitProfile | null>(null);
  const [showFitQuestions, setShowFitQuestions] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("n1_fit_profile");
      if (raw && modal === "register") setSavedFit(JSON.parse(raw));
    } catch {}
  }, [modal]);
  const FIT_KO: Record<string, string> = { A: "정핏", B: "세미오버", C: "오버핏" };

  const TOP = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
  const BOTTOM = ["28~29", "30~31", "32~33", "34~35", "FREE"];

  const doRegister = async (profileOverride?: { gender: string; size: string; fit: string }) => {
    setBusy(true); setErr("");
    const p = profileOverride || { gender, size: size.replace(/\(.*\)/, ""), fit };
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", email: regEmail, password: pw, profile: p }),
      });
      const data = await res.json();
      if (data.ok) { login(data.token, regEmail, data.profile); setConfirmMsg("시작했어요 — 이 핏을 기억할게요"); }
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
      if (data.ok) { login(data.token, regEmail, data.profile); setConfirmMsg("기억했어요"); }
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
        <LiquidSurface
          label={modal === "register" ? "나의 N°1 시작하기" : "다음에도 기억하기"}
          onClose={() => { setModal(null); setConfirmMsg(null); setStep(1); setErr(""); }}
          autoDissipateMs={confirmMsg ? 950 : undefined}
        >
          <div className="lq-stage" key={confirmMsg ? "confirm" : `${modal}-${step}-${showFitQuestions ? "q" : "p"}`}>
            {confirmMsg ? (
              <div className="lq-confirm">
                <p className="lq-confirm-mark">{confirmMsg}</p>
                <p className="lq-confirm-sub">이 핏으로 이어서 보여드릴게요.</p>
              </div>
            ) : modal === "login" ? (
              <>
                <p className="lq-kicker">다음에도 기억하기</p>
                <h3 className="lq-title">돌아오세요</h3>
                <div style={{ marginTop: 12 }}>
                  <input className="lq-input" placeholder="이메일" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} aria-label="이메일" />
                  <input className="lq-input" placeholder="비밀번호" type="password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" />
                  {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
                  <button className="lq-act" disabled={busy || !regEmail || !pw} onClick={doLogin}>
                    {busy ? "확인 중..." : "들어가기"}
                  </button>
                  <div className="lq-ghost-row">
                    <button className="lq-ghost" onClick={() => { setModal("register"); setStep(1); setErr(""); }}>
                      계정이 없나요? 나의 N°1 시작하기
                    </button>
                  </div>
                </div>
              </>
            ) : step === 1 ? (
              <>
                <p className="lq-kicker">나의 N°1 시작하기</p>
                <h3 className="lq-title">기억을 시작할게요</h3>
                <p className="lq-sub">이메일과 비밀번호만 준비되면 충분해요.</p>
                <div style={{ marginTop: 12 }}>
                  <input className="lq-input" placeholder="이메일" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} aria-label="이메일" />
                  <input className="lq-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" />
                  <input className="lq-input" placeholder="비밀번호 확인" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="비밀번호 확인" />
                  {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
                  <button className="lq-act" disabled={busy || !regEmail || !pw || pw !== pw2}
                    onClick={() => { if (pw.length < 6) { setErr("비밀번호는 6자 이상"); return; } setErr(""); setStep(2); }}>
                    {busy ? "처리 중..." : "다음 → 핏 프로필"}
                  </button>
                </div>
              </>
            ) : step === 2 && savedFit && !showFitQuestions ? (
              <>
                <p className="lq-kicker">핏 프로필</p>
                <h3 className="lq-title">이미 만드신 핏이 있어요</h3>
                <p className="lq-sub">
                  {savedFit.gender} · {savedFit.size} · {FIT_KO[savedFit.fit] || savedFit.fit} —
                  다시 답하지 않고 이대로 시작할 수 있어요.
                </p>
                <button className="lq-act" style={{ marginTop: 16 }} disabled={busy}
                  onClick={() => doRegister({ gender: savedFit.gender, size: savedFit.size, fit: savedFit.fit })}>
                  {busy ? "처리 중..." : "이 핏으로 시작하기"}
                </button>
                <div className="lq-ghost-row">
                  <button className="lq-ghost" onClick={() => { setGender(savedFit.gender); setSize(savedFit.size); setFit(savedFit.fit); setShowFitQuestions(true); }}>
                    다시 설정할래요
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="lq-kicker">핏 프로필 — N°1이 나를 기억하는 방식</p>
                <h3 className="lq-title">세 가지만 알려주세요</h3>
                <p className="lq-row-label">성별</p>
                <LqSeg options={[{ v: "남성", t: "남성" }, { v: "여성", t: "여성" }]}
                  value={gender} onChange={setGender} ariaLabel="성별" />
                <p className="lq-row-label">평소 사이즈</p>
                <LqSeg
                  options={(gender === "여성" ? BOTTOM : TOP).map((s) => ({ v: s, t: s }))}
                  value={TOP.includes(size) || BOTTOM.includes(size) ? size : (TOP.find(s => s.replace(/\(.*\)/, "") === size) || BOTTOM.find(s => s.replace(/\(.*\)/, "") === size) || "")}
                  onChange={setSize} ariaLabel="평소 사이즈" vertical />
                <p className="lq-row-label">선호하는 핏</p>
                <LqSeg options={[
                  { v: "A", t: "정핏", d: "딱 맞는 정사이즈" },
                  { v: "B", t: "세미오버", d: "자켓은 한 치수 여유" },
                  { v: "C", t: "오버핏", d: "박시하고 넉넉하게" },
                ]} value={fit} onChange={setFit} ariaLabel="선호하는 핏" />
                {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginTop: 10 }}>{err}</p>}
                <button className="lq-act" style={{ marginTop: 16 }} disabled={busy || !gender || !size || !fit} onClick={() => doRegister()}>
                  {busy ? "처리 중..." : "가입 완료"}
                </button>
              </>
            )}
          </div>
        </LiquidSurface>
      )}
    </>
  );
}
