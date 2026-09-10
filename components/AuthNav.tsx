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
import { PostcodeSearch, emptyAddress, type AddressValue } from "./PostcodeSearch";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const EMAIL_HINT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AuthNav() {
  const { token, email, username, pending, fit, login, logout, saveFit, setPending } = useAuth();
  const [modal, setModal] = useState<null | "register" | "login">(null);
  const [step, setStep] = useState(1);
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  // §11 — 가입 시 기본 배송지(선택). 우편번호 찾기로 공식 주소를 받고 상세는 직접 입력.
  const [regAddr, setRegAddr] = useState<AddressValue>(emptyAddress());
  const addrPartial = Boolean(
    (regAddr.postalCode || regAddr.roadAddress || regAddr.detailAddress) &&
    !(regAddr.postalCode && regAddr.roadAddress)
  );
  const [qFit, setQFit] = useState<PreferredFit | "">("");
  const [qSize, setQSize] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  // 게스트가 이미 만든 핏 컨텍스트 — 회원가입 2단계에서 재질문하지 않고 재사용
  const [showFitQuestions, setShowFitQuestions] = useState(false);
  const userCheck = useUsernameCheck(regUsername);
  const sizeValue = TOP_SIZES.find((s) => s === qSize || s.replace(/\(.*\)/, "") === qSize) ?? "";

  // ── 이메일 인증 대기 화면 — 서버가 발급한 상태만 보여준다(§2 클라이언트 신뢰 금지).
  // via: "session"=가입 직후(대기 세션 토큰으로 정정 가능) / "login"=아이디+비밀번호로 정정
  const [pendingView, setPendingView] = useState<
    null | { email: string; sent: boolean; note?: string; via: "session" | "login"; editing: boolean; editValue: string }
  >(null);
  const [resendIn, setResendIn] = useState(0); // 재발송 쿨다운 표시(초)

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
          body: JSON.stringify({
            action: "register", username: regUsername, email: regEmail, password: pw,
            profile: encodeProfileForServer(base),
            address: regAddr.postalCode && regAddr.roadAddress ? {
              postalCode: regAddr.postalCode,
              roadAddress: regAddr.roadAddress,
              detailAddress: regAddr.detailAddress,
            } : undefined,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          // 인증 필수 정책 — 서버가 대기 계정으로 판정하면 인증 안내 화면으로 보낸다.
          // "보냈다"고 말할 수 있는 건 verificationSent가 true일 때뿐이다(정직 계약).
          if (data.verificationRequired) {
            login(data.token, data.email, data.profile, data.username, true, data.address);
            setPendingView({
              email: data.email, via: "session", editing: false, editValue: "",
              sent: Boolean(data.verificationSent),
              note: data.verificationSent ? undefined : (data.verificationMessage || "인증 메일 발송이 지연되고 있어요 — 잠시 후 다시 보내기로 시도해 주세요"),
            });
          } else {
            login(data.token, data.email, data.profile, data.username, false, data.address);
            setConfirmMsg("시작했어요 — 이 핏을 기억할게요");
          }
        }
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
      if (data.ok) { login(data.token, data.email, data.profile, data.username, data.verificationRequired, data.address); setConfirmMsg("기억했어요"); }
      else if (data.code === "EMAIL_NOT_VERIFIED") {
        // 미인증 대기 계정 — 인증 안내 화면. 아이디+비밀번호는 이미 검증된 값이라
        // 이 화면에서의 이메일 정정(change-pending-email id+password 경로)에 재사용한다.
        const looksEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(regEmail.trim());
        setPendingView({ email: looksEmail ? regEmail.trim() : "", via: "login", editing: false, editValue: "", sent: true });
      }
      else setErr(data.error || "로그인에 실패했어요 — 잠시 후 다시 시도해 주세요");
    } catch { setErr("서버 오류"); } finally { setBusy(false); }
  };

  /* ── 인증 대기 화면 액션 — 재발송(쿨다운) / 이메일 정정 ── */
  const doResend = () => {
    const target = pendingView?.email?.trim();
    if (!target || resendIn > 0) return;
    void (async () => {
      setBusy(true); setErr("");
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resend-verification", email: target }),
        });
        const data = await res.json();
        if (data.ok) {
          setPendingView((v) => (v ? { ...v, sent: true, note: "요청이 접수됐어요 — 메일함을 확인해 주세요" } : v));
          setResendIn(60);
          const timer = setInterval(() => setResendIn((s) => (s <= 1 ? (clearInterval(timer), 0) : s - 1)), 1000);
        } else {
          setPendingView((v) => (v ? { ...v, note: data.error || "재발송에 실패했어요 — 잠시 후 다시 시도해 주세요" } : v));
        }
      } catch { setErr("서버 오류"); } finally { setBusy(false); }
    })();
  };

  const doChangeEmail = () => {
    const view = pendingView;
    const next = view?.editValue?.trim();
    if (!view || !next) return;
    void (async () => {
      setBusy(true); setErr("");
      try {
        const payload: Record<string, unknown> =
          view.via === "session" && token
            ? { action: "change-pending-email", token, newEmail: next }
            : { action: "change-pending-email", id: regEmail.trim(), password: pw, newEmail: next };
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.ok) {
          // 서버가 새 주소로 재발송한 결과만 반영한다 — 새 주소가 곧 진실이 된다.
          setPendingView({ email: data.email, via: view.via, editing: false, editValue: "", sent: Boolean(data.verificationSent),
            note: data.verificationSent ? "새 주소로 인증 메일을 다시 보냈어요" : (data.verificationMessage || "발송이 지연되고 있어요 — 다시 보내기를 눌러 주세요") });
          if (view.via === "session" && token) login(token, data.email, undefined, username, true);
        } else {
          setErr(data.error || "이메일 수정에 실패했어요");
        }
      } catch { setErr("서버 오류"); } finally { setBusy(false); }
    })();
  };

  const fitLabel = fit
    ? `${FIT_LABEL[fit.preferredFit] ?? fit.preferredFit} · 평소 ${fit.topSize || fit.bottomSize || "사이즈 준비 중"}`
    : "";

  const close = () => {
    setModal(null); setConfirmMsg(null); setStep(1); setErr("");
    setPendingView(null); setResendIn(0);
    // 비밀번호 입력값은 모달이 닫히면 상태에서도 버린다 — 평문 잔존 없음(§2)
    setPw(""); setPw2("");
  };

  return (
    <>
      <div className="auth-nav">
        {/* §5 — 스마트 핏은 카테고리 행이 아닌 상단 유틸리티 그룹의 일원.
            같은 auth-link 패밀리 — 작고 조용한 텍스트 링크. */}
        {/* §13 (Mobile Regression Repair): "· 설정됨"은 내비 항목이 아니라 종속 상태 —
            작고 옅게. 링크 라벨은 "스마트 핏"만으로 로그인/회원가입과 동일 위계. */}
        <button
          className="auth-link"
          onClick={() => window.dispatchEvent(new Event("n1:open-fit"))}
          aria-label={fit ? "스마트 핏 — 설정됨, 열어서 수정" : "스마트 핏 설정하기"}
        >
          스마트 핏{fit && <span className="auth-fit-state"> · 설정됨</span>}
        </button>
        {token && email ? (
          <>
            <span className="auth-user">
              {username || email.split("@")[0]}님{fit && ` (${fitLabel})`}
              {pending && <span className="auth-pending-badge" title="이메일 인증 대기 — 메일의 링크로 인증을 완료해 주세요"> · 인증 대기</span>}
              ⚙️
            </span>
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
          <div className="lq-stage" key={confirmMsg ? "confirm" : pendingView ? "verify" : `${modal}-${step}-${showFitQuestions ? "q" : "p"}`}>
            {pendingView ? (
              /* ═══ 이메일 인증 대기 — 서버 상태의 정직한 표시(§1·§5) ═══ */
              <div className="lq-confirm lq-verify">
                <p className="lq-kicker">이메일 인증</p>
                {pendingView.sent ? (
                  <p className="lq-confirm-mark">
                    <strong className="lq-verify-mail">{pendingView.email}</strong> 으로 인증 메일을 보냈어요
                  </p>
                ) : (
                  <p className="lq-confirm-mark">인증 메일 발송이 지연되고 있어요</p>
                )}
                {pendingView.note && <p className="lq-row-note" style={{ marginTop: 8 }}>{pendingView.note}</p>}
                <p className="lq-confirm-sub">
                  메일의 인증 링크를 누르면 가입이 완료돼요. 링크는 10분 동안 유효해요.
                </p>
                {pendingView.editing ? (
                  <div style={{ marginTop: 10 }}>
                    <input className="lq-input" placeholder="새 이메일 주소" type="email" value={pendingView.editValue}
                      onChange={(e) => setPendingView((v) => (v ? { ...v, editValue: e.target.value } : v))}
                      aria-label="새 이메일 주소" autoComplete="email" />
                    {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", margin: "6px 0 8px" }}>{err}</p>}
                    <button className="lq-act" disabled={busy || !pendingView.editValue} onClick={doChangeEmail}>
                      {busy ? "처리 중..." : "이 주소로 다시 보내기"}
                    </button>
                    <div className="lq-ghost-row">
                      <button className="lq-ghost" onClick={() => { setPendingView((v) => (v ? { ...v, editing: false, editValue: "" } : v)); setErr(""); }}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="lq-ghost-row" style={{ marginTop: 14 }}>
                    <button className="lq-ghost" onClick={() => { setPendingView((v) => (v ? { ...v, editing: true, editValue: "" } : v)); setErr(""); }}>
                      이메일 주소 수정
                    </button>
                    <button className="lq-ghost" disabled={busy || resendIn > 0 || !pendingView.email} onClick={doResend}>
                      {resendIn > 0 ? `다시 보내기 (${resendIn}초)` : "인증 메일 다시 보내기"}
                    </button>
                  </div>
                )}
                <p className="lq-row-note" style={{ marginTop: 14, opacity: 0.75 }}>
                  인증을 마치기 전에는 로그인할 수 없어요 — 주문은 계속 게스트로도 가능해요.
                </p>
              </div>
            ) : confirmMsg ? (
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
                  <p className="lq-row-label" style={{ marginTop: 14 }}>기본 배송지 <span style={{ opacity: 0.6 }}>(선택 — 나중에 바꿀 수 있어요)</span></p>
                  <PostcodeSearch value={regAddr} onChange={setRegAddr} compact />
                  {addrPartial ? (
                    <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 8 }}>
                      우편번호 찾기로 주소를 선택하거나, 주소를 비워 두세요
                    </p>
                  ) : null}
                  {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
                  <button className="lq-act"
                    disabled={busy || !regUsername || userCheck.status === "taken" || userCheck.status === "invalid" ||
                      !regEmail || !EMAIL_HINT.test(regEmail) || !pw || pw !== pw2 || addrPartial}
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
