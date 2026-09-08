"use client";
/**
 * N°1 Smart Fit V2 — 플로우 (2026-09-09, Session A: Auth + Smart Fit 기반)
 *
 * 한 서페이스가 상태만 바꾼다(새 모달·새 Glass 재질 금지 — Liquid Surface 재사용):
 *   선호 핏 → 필요한 사이즈 컨텍스트(상의 → 하의) → 결과(RESULT) → (게스트)계정 승격 → 확인
 *
 * Session A 변경 (§4·§5·§8·§10):
 *  - 뒤로 컨트롤: 각 단계 좌측 상단의 작은 원형 컨트롤(← ) — lq-close와 같은
 *    조용한 원형 재질이지 새 Glass가 아니다. 진입 단계에서는 숨긴다(§4).
 *    뒤로 가면 이전 단계로 돌아가고 답했던 선택은 컨텍스트에 그대로 있다.
 *  - 상의 입력 후 바로 결과로 가지 않는다(§5 수정) — 하의 컨텍스트를 아직
 *    모르면 이어서 묻는다. 이미 아는 값은 다시 묻지 않는다(§5·§9).
 *  - 회원가입: 아이디 가용성(서버 조회, §1) + 이메일 문법 검사(§3)를 인라인으로
 *    보여주고, 가입 submit은 서버가 최종 중복을 다시 검사한다.
 *  - 게스트 문구: "지금은 제가 잠깐 기억하고 있어요."(§10) — 브라우저 언급 대신.
 *  - 승격: 가입 성공 → AuthProvider.login이 세션 핏을 계정으로 옮기고 서버에
 *    저장·readback한다 — Smart Fit을 다시 묻지 않는다(§8).
 *
 * 시각 재질은 이 세션 소유가 아니다 — LiquidSurface·LqSeg 공유 재질만 사용한다.
 */
import { useEffect, useRef, useState } from "react";
import LiquidSurface from "./LiquidSurface";
import LqSeg from "./LqSeg";
import { useAuth } from "./AuthProvider";
import { FIT_LABEL, interpretFit, type FitProductInput } from "@/lib/fit";
import {
  type FitContext,
  type PreferredFit,
  encodeProfileForServer,
} from "@/lib/fitContext";
import {
  type SizeTab,
  canGoBack,
  goBack,
  initialFlowState,
  stateAfterFit,
  stateAfterSize,
  stateSwitchSizeTab,
  stateToAccount,
  stateToEdit,
} from "@/lib/fitFlow";
import { useUsernameCheck } from "./useUsernameCheck";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];
const FITS = [
  { v: "A", t: "슬림 · 정핏", d: "깔끔하게 닿는 실루엣" },
  { v: "B", t: "정사이즈 · 세미오버", d: "이너는 정핏, 겉옷은 여유" },
  { v: "C", t: "여유롭게 · 오버", d: "전체적으로 넉넉한 실루엣" },
];
const EMAIL_HINT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const normTop = (v: string) => v.replace(/\(.*\)/, "");

export default function SmartFitFlow({
  onClose,
  product, // PDP에서 열 때 — 이 상품에 대한 해석을 함께 보여준다
  needCategory, // 현재 맥락에서 필요한 사이즈 카테고리 (PDP 상품 카테고리 / 홈은 null → 상의)
}: {
  onClose: () => void;
  product?: FitProductInput | null;
  needCategory?: SizeTab | null;
}) {
  const { fit, token, login, saveFit, resetFit } = useAuth();
  // 단계 머신 — 뒤로 가기 이력과 사이즈 큐는 lib/fitFlow의 순수 함수가 담당(§4·§5)
  const [flow, setFlow] = useState(() => initialFlowState(fit, needCategory ?? null));
  const [topSize, setTopSize] = useState(fit?.topSize ?? "");
  const [bottomSize, setBottomSize] = useState(fit?.bottomSize ?? "");
  const [acctMode, setAcctMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const userCheck = useUsernameCheck(acctMode === "register" ? username : "");

  // 단계 전환 시 제목으로 초점 이동 — 스크린리더가 단계 변화를 읽는다 (§31)
  useEffect(() => {
    headingRef.current?.focus();
  }, [flow.step, flow.sizeTab]);

  const ctx: FitContext = {
    v: 2,
    preferredFit: (fit?.preferredFit ?? "") as PreferredFit,
    topSize: topSize || undefined,
    bottomSize: bottomSize || undefined,
    gender: fit?.gender,
  };
  const fitKnown = Boolean(ctx.preferredFit);
  const emailOk = EMAIL_HINT.test(email);

  const saveQuietly = (patch: Partial<FitContext>) => {
    const next: FitContext = { ...ctx, ...patch, v: 2 };
    // AuthProvider.saveFit이 게스트는 sessionStorage에만, 회원은 기기+서버에 저장한다(§6·§7)
    saveFit(next);
    return next;
  };

  const sizeOptions = (flow.sizeTab === "top" ? TOP_SIZES : BOTTOM_SIZES).map((s) => ({ v: s, t: s }));
  const rawSize = flow.sizeTab === "top" ? topSize : bottomSize;
  const sizeValue =
    sizeOptions.find((o) => o.v === rawSize)?.v ??
    sizeOptions.find((o) => normTop(o.v) === rawSize)?.v ??
    "";

  const interpretation = product && fitKnown ? interpretFit(product, ctx) : null;

  const pickFit = (v: string) => {
    const next = saveQuietly({ preferredFit: v as PreferredFit });
    // 남은 사이즈 질문이 있으면 이어서 — 이미 아는 값은 건너뛴다(§5·§9)
    setFlow((s) => stateAfterFit(s, next, needCategory ?? null));
  };

  const pickSize = (v: string) => {
    const patch: Partial<FitContext> =
      flow.sizeTab === "top" ? { topSize: normTop(v) } : { bottomSize: v };
    if (flow.sizeTab === "top") setTopSize(normTop(v));
    else setBottomSize(v);
    const next = saveQuietly(patch);
    // 상의를 답해도 결과로 튀지 않는다 — 하의 컨텍스트가 남아 있으면 이어서 묻는다(§5)
    setFlow((s) => stateAfterSize(s, next));
  };

  const doReset = () => {
    resetFit(); // 저장된 컨텍스트(게스트 세션/회원 기기+서버)를 지운다(§9)
    onClose();
  };

  const submitAccount = async () => {
    setBusy(true); setErr("");
    try {
      const isLogin = acctMode === "login";
      if (!isLogin && pw !== pw2) { setErr("비밀번호가 서로 일치하지 않습니다"); return; }
      const payload = isLogin
        ? { action: "login", id: email || username, password: pw }
        : { action: "register", username, email, password: pw, profile: encodeProfileForServer(ctx) };
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        // 승격: 게스트 세션 핏 → 계정 저장 → 서버 readback. 질문 반복 없음(§8).
        login(data.token, data.email, data.profile, data.username);
        setFlow((s) => ({ ...s, step: "confirm", history: [] }));
      } else {
        setErr(data.error || "잠시 후 다시 시도해 주세요");
      }
    } catch {
      setErr("연결이 불안정해요 — 잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  };

  const back = () => setFlow((s) => goBack(s));
  const showBack = canGoBack(flow);

  return (
    <LiquidSurface
      label="스마트 핏 — 내 핏 설정"
      onClose={onClose}
      autoDissipateMs={flow.step === "confirm" ? 950 : undefined}
    >
      {showBack && (
        <button
          type="button"
          className="lq-back"
          aria-label="이전 단계로"
          onClick={back}
        >
          ←
        </button>
      )}
      <div className="lq-stage" key={`${flow.step}-${flow.sizeTab}`}>
        {flow.step === "fit" && (
          <>
            <p className="lq-kicker">스마트 핏 — 첫 질문</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>어떤 핏을 좋아하세요?</h3>
            <p className="lq-sub">첫 질문 하나로 방향을 잡아요 — 필요한 것만 더 여쭤볼게요.</p>
            <div style={{ marginTop: 18 }}>
              <LqSeg options={FITS} value={ctx.preferredFit} onChange={pickFit} ariaLabel="선호하는 핏" />
            </div>
            {fitKnown ? (
              <div className="lq-ghost-row">
                <button className="lq-ghost" onClick={() => setFlow((s) => ({ ...s, step: "result", history: [...s.history, { step: "fit" }] }))}>
                  설정 유지하고 결과 보기
                </button>
              </div>
            ) : null}
          </>
        )}

        {flow.step === "size" && (
          <>
            <p className="lq-kicker">스마트 핏 — 사이즈</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>평소 사이즈는 어떻게 되세요?</h3>
            <p className="lq-sub">
              {flow.sizeTab === "bottom"
                ? "이 상품이 하의라 하의 기준으로 여쭤봐요."
                : "상의 기준이에요 — 다음에 하의도 여쭤볼게요."}
            </p>
            <div className="lq-ghost-row" style={{ justifyContent: "flex-start", marginTop: 12, marginBottom: 8 }}>
              <button className="lq-ghost" onClick={() => setFlow((s) => stateSwitchSizeTab(s, "top"))}
                style={flow.sizeTab === "top" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>상의</button>
              <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
              <button className="lq-ghost" onClick={() => setFlow((s) => stateSwitchSizeTab(s, "bottom"))}
                style={flow.sizeTab === "bottom" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>하의</button>
            </div>
            <LqSeg
              options={sizeOptions}
              value={sizeValue}
              onChange={pickSize}
              ariaLabel={`평소 ${flow.sizeTab === "top" ? "상의" : "하의"} 사이즈`}
              vertical
            />
            <div className="lq-ghost-row">
              {fitKnown ? (
                <button className="lq-ghost" onClick={() => setFlow((s) => ({ ...s, step: "result", history: [...s.history, { step: "size", sizeTab: s.sizeTab }] }))}>
                  건너뛰기
                </button>
              ) : null}
            </div>
          </>
        )}

        {flow.step === "result" && fitKnown && (
          <>
            <p className="lq-kicker">스마트 핏</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1} style={{ marginBottom: 12 }}>
              {ctx.preferredFit ? `${FIT_LABEL[ctx.preferredFit]} 취향이시네요` : ""}
            </h3>
            <p className="lq-row-text">
              {ctx.topSize ? `평소 상의 ${ctx.topSize}` : "평소 상의 사이즈 준비 중"}
              {ctx.bottomSize ? ` · 평소 하의 ${ctx.bottomSize}` : ""}
            </p>
            <hr className="lq-sep" />
            {product && interpretation ? (
              <>
                <p className="lq-kicker">Product</p>
                <p className="lq-row-text">{interpretation.productFact}</p>
                <p className="lq-kicker" style={{ marginTop: 14 }}>Interpretation</p>
                <p className="lq-row-text">{interpretation.interpretation}</p>
                {interpretation.sizeHint ? <p className="lq-row-note" style={{ marginTop: 6 }}>{interpretation.sizeHint}</p> : null}
                <p className="lq-row-note" style={{ marginTop: 8 }}>{interpretation.limitation}</p>
              </>
            ) : (
              <>
                <p className="lq-kicker">Interpretation</p>
                <p className="lq-row-text">
                  상품 페이지에서 스마트 핏을 열면, 그 상품의 실루엣과 내 설정을 함께 안내해 드려요.
                </p>
                <p className="lq-row-note">
                  정확한 호수는 실측 수치표가 공개된 상품만 함께 확인해요.
                </p>
              </>
            )}
            <hr className="lq-sep" />
            {token ? (
              <p className="lq-row-note">내 계정에 저장되어 있어요 — 수정하면 바로 반영돼요.</p>
            ) : (
              <>
                <p className="lq-row-text" style={{ fontWeight: 600 }}>이 핏을 다음에도 기억할까요?</p>
                <p className="lq-row-note" style={{ marginBottom: 10 }}>지금은 제가 잠깐 기억하고 있어요.</p>
                <button className="lq-act" onClick={() => { setAcctMode("login"); setErr(""); setFlow((s) => stateToAccount(s)); }}>
                  로그인하고 기억하기
                </button>
              </>
            )}
            <div className="lq-ghost-row">
              <button className="lq-ghost" onClick={() => setFlow((s) => stateToEdit(s))}>설정 수정</button>
              <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
              {confirmReset ? (
                <>
                  <button className="lq-ghost" style={{ color: "#a0432d" }} onClick={doReset}>지우기</button>
                  <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
                  <button className="lq-ghost" onClick={() => setConfirmReset(false)}>취소</button>
                </>
              ) : (
                <button className="lq-ghost" onClick={() => setConfirmReset(true)}>초기화</button>
              )}
            </div>
          </>
        )}

        {flow.step === "account" && (
          <>
            <p className="lq-kicker">{acctMode === "login" ? "다음에도 기억하기" : "나의 N°1 시작하기"}</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>
              {acctMode === "login" ? "로그인하고 핏 기억하기" : "계정 만들고 핏 기억하기"}
            </h3>
            <p className="lq-sub">방금 설정한 핏이 그대로 저장됩니다 — 다시 답할 필요가 없어요.</p>
            <div style={{ marginTop: 14 }}>
              {acctMode === "register" && (
                <>
                  <input
                    className="lq-input"
                    placeholder="아이디 (영문 소문자·숫자·_ 3~20자)"
                    type="text"
                    value={username}
                    autoComplete="username"
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={userCheck.recheckNow}
                    aria-label="아이디"
                    aria-describedby="fit-username-hint"
                  />
                  {userCheck.message ? (
                    <p
                      id="fit-username-hint"
                      className="lq-row-note lq-avail"
                      data-status={userCheck.status}
                      role={userCheck.status === "taken" || userCheck.status === "invalid" ? "alert" : undefined}
                      style={{ marginTop: -6, marginBottom: 8 }}
                    >
                      {userCheck.message}
                    </p>
                  ) : null}
                </>
              )}
              <input
                className="lq-input"
                placeholder={acctMode === "login" ? "아이디 또는 이메일" : "이메일"}
                type={acctMode === "login" ? "text" : "email"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label={acctMode === "login" ? "아이디 또는 이메일" : "이메일"}
              />
              {acctMode === "register" && email && !emailOk ? (
                <p className="lq-row-note" style={{ color: "#a0432d", marginTop: -6, marginBottom: 8 }}>
                  올바른 이메일 형식이 아닙니다
                </p>
              ) : null}
              <input className="lq-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw}
                autoComplete={acctMode === "login" ? "current-password" : "new-password"}
                onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" />
              {acctMode === "register" && (
                <input className="lq-input" placeholder="비밀번호 확인" type="password" value={pw2}
                  autoComplete="new-password"
                  onChange={(e) => setPw2(e.target.value)} aria-label="비밀번호 확인" />
              )}
              {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
              <button className="lq-act"
                disabled={busy ||
                  (acctMode === "login"
                    ? !(email || username) || pw.length < 6
                    : userCheck.status === "taken" || userCheck.status === "invalid" || !username || !emailOk || pw.length < 6 || pw !== pw2)}
                onClick={submitAccount}>
                {busy ? "확인 중..." : acctMode === "login" ? "들어가기" : "가입하고 기억하기"}
              </button>
              <div className="lq-ghost-row">
                <button className="lq-ghost" onClick={() => { setAcctMode(acctMode === "login" ? "register" : "login"); setErr(""); }}>
                  {acctMode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
                </button>
                <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
                <button className="lq-ghost" onClick={() => setFlow((s) => goBack(s))}>← 결과로</button>
              </div>
            </div>
          </>
        )}

        {flow.step === "confirm" && (
          <div className="lq-confirm">
            <p className="lq-confirm-mark">기억했어요</p>
            <p className="lq-confirm-sub">계정에 저장됐어요 — 다음에도 이 핏으로 이어집니다.</p>
          </div>
        )}
      </div>
    </LiquidSurface>
  );
}
