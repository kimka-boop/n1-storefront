"use client";
/**
 * N°1 Smart Fit V2 — 플로우 (2026-09-09, Smart Fit V2 미션)
 *
 * 한 서페이스가 상태만 바꾼다(새 모달 금지 — Liquid Surface System 재사용):
 *   선호 핏 → (필요할 때만) 평소 사이즈 → 해석(RESULT) → (게스트)계정 승격 → 확인
 *
 * V2 변경:
 *  - FIT CONTEXT: 답한 순간 조용히 저장된다(게스트 즉시 — §8). 다음 상품에서
 *    같은 질문을 반복하지 않고(§9), 현재 상품 카테고리에 필요한 사이즈만 추가 질문(§7).
 *  - 성별 질문 제거 — 어떤 판단에도 쓰이지 않았다(§5). 계정 저장 시에만
 *    '미지정'으로 /api/auth 계약을 유지한다.
 *  - 결과는 interpretFit 4층(PRODUCT FACT / YOUR CONTEXT / INTERPRETATION /
 *    LIMITATION) — 근거가 허용하는 만큼만 말한다(§14–15).
 *  - 수정·초기화가 결과 화면에 항상 있다(§26–27).
 *  - 로그인 실패/취소 시 게스트 컨텍스트는 그대로(§35 CASE 15).
 *
 * 시각 재질은 이 세션 소유가 아니다 — 최종 Liquid Glass는 Glass Lab 인계(§33).
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

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];
const FITS = [
  { v: "A", t: "슬림 · 정핏", d: "깔끔하게 닿는 실루엣" },
  { v: "B", t: "정사이즈 · 세미오버", d: "이너는 정핏, 겉옷은 여유" },
  { v: "C", t: "여유롭게 · 오버", d: "전체적으로 넉넉한 실루엣" },
];

type Step = "fit" | "size" | "result" | "account" | "confirm";
type SizeTab = "top" | "bottom";

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
  const [step, setStep] = useState<Step>(() => {
    if (!fit) return "fit";
    const want: SizeTab = needCategory ?? "top";
    const have = want === "bottom" ? fit.bottomSize : fit.topSize;
    return have ? "result" : "size"; // 이미 아는 값은 다시 묻지 않는다 (§7·§9)
  });
  const [sizeTab, setSizeTab] = useState<SizeTab>(needCategory ?? "top");
  const [topSize, setTopSize] = useState(fit?.topSize ?? "");
  const [bottomSize, setBottomSize] = useState(fit?.bottomSize ?? "");
  const [acctMode, setAcctMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 단계 전환 시 제목으로 초점 이동 — 스크린리더가 단계 변화를 읽는다 (§31)
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const ctx: FitContext = {
    v: 2,
    preferredFit: (fit?.preferredFit ?? "") as PreferredFit,
    topSize: topSize || undefined,
    bottomSize: bottomSize || undefined,
    gender: fit?.gender,
  };
  const fitKnown = Boolean(ctx.preferredFit);

  const saveQuietly = (patch: Partial<FitContext>) => {
    const next: FitContext = { ...ctx, ...patch, v: 2 };
    // AuthProvider.saveFit이 localStorage + (로그인 시) 서버 동기까지 담당
    saveFit(next);
    return next;
  };

  const sizeOptions = (sizeTab === "top" ? TOP_SIZES : BOTTOM_SIZES).map((s) => ({ v: s, t: s }));
  const rawSize = sizeTab === "top" ? topSize : bottomSize;
  const sizeValue =
    sizeOptions.find((o) => o.v === rawSize)?.v ??
    sizeOptions.find((o) => normTop(o.v) === rawSize)?.v ??
    "";

  const interpretation = product && fitKnown ? interpretFit(product, ctx) : null;

  const pickFit = (v: string) => {
    saveQuietly({ preferredFit: v as PreferredFit });
    // 다음 필요 질문으로 — 현재 맥락의 사이즈가 이미 있으면 바로 결과 (§7)
    const want: SizeTab = needCategory ?? "top";
    const have = want === "bottom" ? bottomSize : normTop(topSize) || topSize;
    setStep(have ? "result" : "size");
  };

  const pickSize = (v: string) => {
    if (sizeTab === "top") setTopSize(normTop(v));
    else setBottomSize(v);
    saveQuietly(sizeTab === "top" ? { topSize: normTop(v) } : { bottomSize: v });
    setStep("result");
  };

  const doReset = () => {
    resetFit(); // 저장된 컨텍스트 · UI 제네릭 상태 복귀 (§27)
    onClose();
  };

  const submitAccount = async () => {
    setBusy(true); setErr("");
    try {
      const isLogin = acctMode === "login";
      if (!isLogin && pw !== pw2) { setErr("비밀번호가 서로 일치하지 않습니다"); return; }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLogin
            ? { action: "login", email, password: pw }
            : { action: "register", email, password: pw, profile: encodeProfileForServer(ctx) },
        ),
      });
      const data = await res.json();
      if (data.ok) {
        login(data.token, email, data.profile); // 병합 정책: 서버가 비어 있으면 방금 만든 컨텍스트 승격
        setStep("confirm");
      } else {
        setErr(data.error || "잠시 후 다시 시도해 주세요");
      }
    } catch {
      setErr("연결이 불안정해요 — 잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LiquidSurface
      label="스마트 핏 — 내 핏 설정"
      onClose={onClose}
      autoDissipateMs={step === "confirm" ? 950 : undefined}
    >
      <div className="lq-stage" key={step}>
        {step === "fit" && (
          <>
            <p className="lq-kicker">스마트 핏 — 1/2</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>어떤 핏을 좋아하세요?</h3>
            <p className="lq-sub">첫 질문 하나로 방향을 잡아요 — 필요한 것만 더 여쭤볼게요.</p>
            <div style={{ marginTop: 18 }}>
              <LqSeg options={FITS} value={ctx.preferredFit} onChange={pickFit} ariaLabel="선호하는 핏" />
            </div>
            {fit?.topSize || fit?.bottomSize ? (
              <div className="lq-ghost-row">
                <button className="lq-ghost" onClick={() => setStep("result")}>설정 유지하고 결과 보기</button>
              </div>
            ) : null}
          </>
        )}

        {step === "size" && (
          <>
            <p className="lq-kicker">스마트 핏 — 2/2</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>평소 사이즈는 어떻게 되세요?</h3>
            <p className="lq-sub">
              {needCategory === "bottom"
                ? "이 상품이 하의라 하의 기준으로 여쭤봐요."
                : "상의 기준이에요 — 하의는 하의 상품에서 나중에 여쭤볼게요."}
            </p>
            <div className="lq-ghost-row" style={{ justifyContent: "flex-start", marginTop: 12, marginBottom: 8 }}>
              <button className="lq-ghost" onClick={() => setSizeTab("top")}
                style={sizeTab === "top" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>상의</button>
              <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
              <button className="lq-ghost" onClick={() => setSizeTab("bottom")}
                style={sizeTab === "bottom" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>하의</button>
            </div>
            <LqSeg
              options={sizeOptions}
              value={sizeValue}
              onChange={pickSize}
              ariaLabel={`평소 ${sizeTab === "top" ? "상의" : "하의"} 사이즈`}
              vertical
            />
            <div className="lq-ghost-row">
              {fitKnown ? (
                <button className="lq-ghost" onClick={() => setStep("result")}>건너뛰기</button>
              ) : (
                <button className="lq-ghost" onClick={() => setStep("fit")}>← 이전</button>
              )}
            </div>
          </>
        )}

        {step === "result" && fitKnown && (
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
                <p className="lq-row-note" style={{ marginBottom: 10 }}>지금은 이 브라우저에 저장되어 있어요.</p>
                <button className="lq-act" onClick={() => { setAcctMode("login"); setErr(""); setStep("account"); }}>
                  로그인하고 기억하기
                </button>
              </>
            )}
            <div className="lq-ghost-row">
              <button className="lq-ghost" onClick={() => setStep("fit")}>설정 수정</button>
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

        {step === "account" && (
          <>
            <p className="lq-kicker">{acctMode === "login" ? "다음에도 기억하기" : "나의 N°1 시작하기"}</p>
            <h3 className="lq-title" ref={headingRef} tabIndex={-1}>
              {acctMode === "login" ? "로그인하고 핏 기억하기" : "계정 만들고 핏 기억하기"}
            </h3>
            <p className="lq-sub">방금 설정한 핏이 그대로 저장됩니다 — 다시 답할 필요가 없어요.</p>
            <div style={{ marginTop: 14 }}>
              <input className="lq-input" placeholder="이메일" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} aria-label="이메일" />
              <input className="lq-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw}
                onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" />
              {acctMode === "register" && (
                <input className="lq-input" placeholder="비밀번호 확인" type="password" value={pw2}
                  onChange={(e) => setPw2(e.target.value)} aria-label="비밀번호 확인" />
              )}
              {err && <p className="lq-row-note" role="alert" style={{ color: "#a0432d", marginBottom: 10 }}>{err}</p>}
              <button className="lq-act" disabled={busy || !email || pw.length < 6 || (acctMode === "register" && pw !== pw2)}
                onClick={submitAccount}>
                {busy ? "확인 중..." : acctMode === "login" ? "들어가기" : "가입하고 기억하기"}
              </button>
              <div className="lq-ghost-row">
                <button className="lq-ghost" onClick={() => setAcctMode(acctMode === "login" ? "register" : "login")}>
                  {acctMode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
                </button>
                <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
                <button className="lq-ghost" onClick={() => setStep("result")}>← 결과로</button>
              </div>
            </div>
          </>
        )}

        {step === "confirm" && (
          <div className="lq-confirm">
            <p className="lq-confirm-mark">기억했어요</p>
            <p className="lq-confirm-sub">계정에 저장됐어요 — 다음에도 이 핏으로 이어집니다.</p>
          </div>
        )}
      </div>
    </LiquidSurface>
  );
}
