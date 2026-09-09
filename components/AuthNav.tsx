"use client";

/**
 * [헤더 네비 — AUTH] 로그인/회원가입 + 로그인 상태 표시 + 회원가입 모달(2단계)
 * (Session A — AUTH + SMART FIT 기반, 2026-09-09)
 *
 * 회원가입 2단계 — 게스트가 이미 만든 핏 컨텍스트가 있으면 다시 묻지 않고
 * 그대로 계정으로 승격한다(질문 무반복 원칙). 성별은 질문하지 않는다 —
 * /api/auth 계약 유지를 위해 '미지정'으로 저장한다(lib/fitContext.ts).
 *
 * Session A 변경:
 *  - 회원가입 1단계에 아이디(username) 추가 — debounce/blur로 서버 가용성 확인,
 *    AVAILABLE/TAKEN 인라인 피드백(§1). 제출 시 서버가 최종 중복을 다시 검사한다.
 *  - 이메일 문법 검사 인라인(§3) — 소유 확인은 EMAIL_VERIFY_DEFERRED 계약.
 *  - 로그인은 아이디 또는 이메일 겸용.
 *  - 가입 성공 시 AuthProvider.login이 세션 핏을 계정으로 승격·readback한다 —
 *    Smart Fit을 다시 묻지 않는다(§8).
 */
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import LiquidSurface from "./LiquidSurface";
import LqSeg from "./LqSeg";
import { FIT_LABEL } from "@/lib/fit";
import { type FitContext, type PreferredFit, encodeProfileForServer } from "@/lib/fitContext";
import { useUsernameCheck } from "./useUsernameCheck";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const EMAIL_HINT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AuthNav() {
  const { token, email, username, fit, login, logout, saveFit } = useAuth();
  const [modal, setModal] = useState<null | "register" | "login">(null);
  const [step, setStep] = useState(1);
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [qFit, setQFit] = useState<PreferredFit | "">("");
  const [qSize, setQSize] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  // 게스트가 이미 만든 핏 컨텍스트 — 회원가입 2단계에서 재질문하지 않고 재사용
  const [showFitQuestions, setShowFitQuestions] = useState(false);
  const userCheck = useUsernameCheck(regUsername);
  const sizeValue = TOP_SIZES.find((s) => s === qSize || s.replace(/\(.*\)/, "") === qSize) ?? "";

  const doRegister = (profileOverride?: FitContext) => {
    const base: FitContext | null =
      profileOverride ??
      (qFit && sizeValue ? { v: 2, preferredFit: qFit, topSize: sizeValue.replace(/\(.*\)/, "") } : null);
    if (!base) { setErr("선호하는 핏과 평소 사이즈를 알려주세요"); return; }
    if (userCheck.status === "taken" || userCheck.status === "invalid") {
      setErr(userCheck.message || "아이디를 확인해 주세요");
      return;
    }
    void (async () => {
      setBusy(true); setErr("");
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "register", username: regUsername, email: regEmail, password: pw, profile: encodeProfileForServer(base) }),
        });
        const data = await res.json();
        if (data.ok) { login(data.token, data.email, data.profile, data.username); setConfirmMsg("시작했어요 — 이 핏을 기억할게요"); }
        else setErr(data.error || "가입에 실패했어요 — 잠시 후 다시 시도해 주세요");
      } catch { setErr("서버 오류"); } finally { setBusy(false); }
    })();
  };

  const doLogin = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", id: regEmail, password: pw }),
      });
      const data = await res.json();
      if (data.ok) { login(data.token, data.email, data.profile, data.username); setConfirmMsg("기억했어요"); }
      else setErr(data.error || "로그인에 실패했어요 — 잠시 후 다시 시도해 주세요");
    } catch { setErr("서버 오류"); } finally { setBusy(false); }
  };

  const fitLabel = fit
    ? `${FIT_LABEL[fit.preferredFit] ?? fit.preferredFit} · 평소 ${fit.topSize || fit.bottomSize || "사이즈 준비 중"}`
    : "";

  const close = () => {
    setModal(null); setConfirmMsg(null); setStep(1); setErr("");
    // 비밀번호 입력값은 모달이 닫히면 상태에서도 버린다 — 평문 잔존 없음(§2)
    setPw(""); setPw2("");
  };

  return (
    <>
      <div className="auth-nav">
        {token && email ? (
          <>
            <span className="auth-user">{username || email.split("@")[0]}님{fit && ` (${fitLabel})`} ⚙️</span>
            <button className="auth-link" onClick={logout}>로그아웃</button>
          </>
        ) : (
          <>
            <button className="auth-link" onClick={() => { setModal("login"); setStep(1); setErr(""); setConfirmMsg(null); }}>로그인</button>
            <button className="auth-link primary" onClick={() => { setModal("register"); setStep(1); setErr(""); setConfirmMsg(null); }}>회원가입</button>
          </>
        )}
      </div>

      {modal && (
        <LiquidSurface
          label={modal === "register" ? "나의 N°1 시작하기" : "다음에도 기억하기"}
          onClose={close}
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
                <h3 className="lq-title">돌아오셨네요</h3>
                <div style={{ marginTop: 12 }}>
                  <input className="lq-input" placeholder="아이디 또는 이메일" type="text" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} aria-label="아이디 또는 이메일" autoComplete="username" />
                  <input className="lq-input" placeholder="비밀번호" type="password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" autoComplete="current-password" />
                  {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
                  <button className="lq-act" disabled={busy || !regEmail || !pw} onClick={doLogin}>
                    {busy ? "확인 중..." : "들어가기"}
                  </button>
                  <div className="lq-ghost-row">
                    <button className="lq-ghost" onClick={() => { setModal("register"); setStep(1); setErr(""); setConfirmMsg(null); }}>
                      계정이 없나요? 나의 N°1 시작하기
                    </button>
                  </div>
                </div>
              </>
            ) : step === 1 ? (
              <>
                <p className="lq-kicker">나의 N°1 시작하기</p>
                <h3 className="lq-title">기억을 시작할게요</h3>
                <p className="lq-sub">아이디 · 이메일 · 비밀번호면 충분해요.</p>
                <div style={{ marginTop: 12 }}>
                  <input className="lq-input" placeholder="아이디 (영문 소문자·숫자·_ 3~20자)" type="text" value={regUsername}
                    autoComplete="username" onChange={(e) => setRegUsername(e.target.value)} onBlur={userCheck.recheckNow}
                    aria-label="아이디" aria-describedby="nav-username-hint" />
                  {userCheck.message ? (
                    <p id="nav-username-hint" className="lq-row-note lq-avail" data-status={userCheck.status}
                      role={userCheck.status === "taken" || userCheck.status === "invalid" ? "alert" : undefined}
                      style={{ marginTop: -6, marginBottom: 8 }}>
                      {userCheck.message}
                    </p>
                  ) : null}
                  <input className="lq-input" placeholder="이메일" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} aria-label="이메일" autoComplete="email" />
                  {regEmail && !EMAIL_HINT.test(regEmail) ? (
                    <p className="lq-row-note" style={{ color: "#a0432d", marginTop: -6, marginBottom: 8 }}>
                      올바른 이메일 형식이 아닙니다
                    </p>
                  ) : null}
                  <input className="lq-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" autoComplete="new-password" />
                  <input className="lq-input" placeholder="비밀번호 확인" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="비밀번호 확인" autoComplete="new-password" />
                  {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
                  <button className="lq-act"
                    disabled={busy || !regUsername || userCheck.status === "taken" || userCheck.status === "invalid" ||
                      !regEmail || !EMAIL_HINT.test(regEmail) || !pw || pw !== pw2}
                    onClick={() => { if (pw.length < 6) { setErr("비밀번호는 6자 이상"); return; } setErr(""); setStep(2); }}>
                    {busy ? "처리 중..." : "다음 → 핏 프로필"}
                  </button>
                </div>
              </>
            ) : fit && !showFitQuestions ? (
              <>
                <p className="lq-kicker">핏 프로필</p>
                <h3 className="lq-title">이미 만드신 핏이 있어요</h3>
                <p className="lq-sub">
                  {FIT_LABEL[fit.preferredFit] ?? fit.preferredFit}
                  {fit.topSize ? ` · 평소 상의 ${fit.topSize}` : ""}
                  {fit.bottomSize ? ` · 평소 하의 ${fit.bottomSize}` : ""} —
                  다시 답하지 않고 이대로 시작할 수 있어요.
                </p>
                <button className="lq-act" style={{ marginTop: 16 }} disabled={busy}
                  onClick={() => doRegister(fit)}>
                  {busy ? "처리 중..." : "이 핏으로 시작하기"}
                </button>
                <div className="lq-ghost-row">
                  <button className="lq-ghost" onClick={() => { setQFit(fit.preferredFit); setQSize(fit.topSize || ""); setShowFitQuestions(true); }}>
                    다시 설정할래요
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="lq-kicker">핏 프로필 — N°1이 나를 기억하는 방식</p>
                <h3 className="lq-title">두 가지만 알려주세요</h3>
                <p className="lq-row-label">선호하는 핏</p>
                <LqSeg options={[
                  { v: "A", t: "슬림 · 정핏", d: "깔끔하게 닿는 실루엣" },
                  { v: "B", t: "정사이즈 · 세미오버", d: "이너는 정핏, 겉옷은 여유" },
                  { v: "C", t: "여유롭게 · 오버", d: "전체적으로 넉넉한 실루엣" },
                ]} value={qFit} onChange={(v) => setQFit(v as PreferredFit)} ariaLabel="선호하는 핏" />
                <p className="lq-row-label">평소 상의 사이즈</p>
                <LqSeg
                  options={TOP_SIZES.map((s) => ({ v: s, t: s }))}
                  value={sizeValue}
                  onChange={(v) => setQSize(v)} ariaLabel="평소 상의 사이즈" vertical />
                {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginTop: 10 }}>{err}</p>}
                <button className="lq-act" style={{ marginTop: 16 }} disabled={busy || !qFit || !sizeValue} onClick={() => doRegister()}>
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
