"use client";
/**
 * N°1 Smart Fit — Liquid Surface 플로우 (2026-09-08 재구성)
 *
 * 하나의 유리 서페이스가 재질의 상태만 바꾼다(새 모달 금지):
 *   선호 핏 → 성별 → 기준 사이즈 → 해석(RESULT) → (게스트)저장 제안 → 계정 → 확인
 *  - 프로필 보유 재진입자는 해석 서페이스부터 (질문 무반복)
 *  - 게스트 결과를 먼저 보여주고, 그다음에만 "이 핏을 다음에도 기억할까요?"
 *  - 계정(로그인/가입)도 같은 재질이 변환된 것 — 방금 만든 프로필이 그대로 저장
 *  - 완료는 "기억했어요" 짧은 확인 뒤 서페이스가 소멸 (§17)
 * 데이터 계약 변경 없음 — /api_auth + FitProfile 그대로.
 */
import { useState } from "react";
import LiquidSurface from "./LiquidSurface";
import LqSeg from "./LqSeg";
import { FIT_LABEL, fitGuidance, type FitProfile } from "@/lib/fit";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];
const FITS = [
  { v: "A", t: "슬림 · 정핏", d: "깔끔하게 닿는 실루엣" },
  { v: "B", t: "정사이즈 · 세미오버", d: "이너는 정핏, 겉옷은 여유" },
  { v: "C", t: "여유롭게 · 오버", d: "전체적으로 넉넉한 실루엣" },
];

type Phase = "fit" | "gender" | "size" | "result" | "account" | "confirm";
type ConfirmKind = "browser" | "account";

export default function SmartFitFlow({
  initial,
  isLoggedIn,
  onSave,
  onAuthed,
  onClose,
  product, // PDP에서 열 때 — 상품이 배경 컨텍스트로 해석에 참여
}: {
  initial: FitProfile | null;
  isLoggedIn: boolean;
  onSave: (p: FitProfile) => void;
  onAuthed: (token: string, email: string, profile: FitProfile) => void;
  onClose: () => void;
  product?: { name: string; fitShape?: string; sizeChart?: string } | null;
}) {
  const [phase, setPhase] = useState<Phase>(initial ? "result" : "fit");
  const [gender, setGender] = useState(initial?.gender || "");
  const [category, setCategory] = useState<"top" | "bottom">("top");
  const [size, setSize] = useState(initial?.size || "");
  const [fit, setFit] = useState(initial?.fit || "");
  const [acctMode, setAcctMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>("browser");

  const sizeOptions = (category === "top" ? TOP_SIZES : BOTTOM_SIZES).map((s) => ({ v: s, t: s }));
  // 상태의 size는 저장형(괄호 제거)과 선택형(괄호 포함)이 섞일 수 있다 — 옵션 기준으로 정규화
  const sizeValue =
    sizeOptions.find((o) => o.v === size)?.v ??
    sizeOptions.find((o) => o.v.replace(/\(.*\)/, "") === size)?.v ?? "";
  const profile: FitProfile = { gender, size: (sizeValue || size).replace(/\(.*\)/, ""), fit };
  const complete = Boolean(profile.gender && profile.size && profile.fit);

  const guidance = product ? fitGuidance(product, complete ? profile : initial) : null;

  const nextOf = (p: Phase): Phase =>
    p === "fit" ? "gender" : p === "gender" ? "size" : "result";

  const saveQuietly = () => {
    onSave(profile);
    setConfirmKind("browser");
    setPhase("confirm");
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
            : { action: "register", email, password: pw, profile },
        ),
      });
      const data = await res.json();
      if (data.ok) {
        onAuthed(data.token, email, profile); // 방금 만든 핏 프로필 유지·서버 동기화
        setConfirmKind("account");
        setPhase("confirm");
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
      label="나에게 맞게 보기 — 핏 프로필"
      onClose={onClose}
      autoDissipateMs={phase === "confirm" ? 950 : undefined}
    >
      <div className="lq-stage" key={phase}>
        {phase === "fit" && (
          <>
            <p className="lq-kicker">Smart Fit — 1 / 3</p>
            <h3 className="lq-title">어떤 핏을 좋아하세요?</h3>
            <p className="lq-sub">첫 질문 하나면 충분해요 — 나머지는 취향에 맞춰 조용히 반영합니다.</p>
            <div style={{ marginTop: 18 }}>
              <LqSeg options={FITS} value={fit} onChange={setFit} ariaLabel="선호하는 핏" />
            </div>
          </>
        )}

        {phase === "gender" && (
          <>
            <p className="lq-kicker">Smart Fit — 2 / 3</p>
            <h3 className="lq-title">어떤 실루엣 기준이 편하세요?</h3>
            <div style={{ marginTop: 18 }}>
              <LqSeg
                options={[{ v: "남성", t: "남성" }, { v: "여성", t: "여성" }]}
                value={gender} onChange={setGender} ariaLabel="성별"
              />
            </div>
          </>
        )}

        {phase === "size" && (
          <>
            <p className="lq-kicker">Smart Fit — 3 / 3</p>
            <h3 className="lq-title">평소 입는 기준 사이즈는?</h3>
            <div className="lq-ghost-row" style={{ justifyContent: "flex-start", marginTop: 6, marginBottom: 10 }}>
              <button className="lq-ghost" onClick={() => setCategory("top")}
                style={category === "top" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>상의</button>
              <button className="lq-ghost" onClick={() => setCategory("bottom")}
                style={category === "bottom" ? { color: "var(--ink)", fontWeight: 600 } : undefined}>하의</button>
            </div>
            <LqSeg options={sizeOptions} value={sizeValue}
              onChange={(v) => setSize(v)} ariaLabel="평소 사이즈" vertical />
          </>
        )}

        {phase === "result" && complete && (
          <>
            <p className="lq-kicker">Your preference</p>
            <p className="lq-row-text">
              {FIT_LABEL[profile.fit] || ""} · 평소 {profile.size} ({category === "top" ? "상의" : "하의"} 기준)
            </p>
            <hr className="lq-sep" />
            {product && guidance ? (
              <>
                <p className="lq-kicker">Product</p>
                <p className="lq-row-text">{guidance.fact}</p>
                <p className="lq-kicker" style={{ marginTop: 16 }}>Interpretation</p>
                <p className="lq-row-text">{guidance.preference}</p>
                <p className="lq-row-note">{guidance.note}</p>
                <p className="lq-row-note">확인 가능한 상품 정보(종류·수치표)와 선호를 기준으로 안내해요.</p>
              </>
            ) : (
              <>
                <p className="lq-kicker">Interpretation</p>
                <p className="lq-row-text">
                  정확한 호수는 수치표가 공개된 상품만 안내해요.
                  {profile.fit === "B" || profile.fit === "C"
                    ? " 겉옷은 취향에 따라 한 치수 이상 여유를 두고 보시면 돼요."
                    : " 평소 사이즈 기준으로 보시면 돼요."}
                </p>
                <p className="lq-row-note">상품 페이지에서 이 서페이스를 다시 열면, 그 상품과 함께 해석해 드려요.</p>
              </>
            )}
            {isLoggedIn ? (
              <>
                <hr className="lq-sep" />
                <button className="lq-act" onClick={saveQuietly}>내 계정에 저장</button>
                <div className="lq-ghost-row">
                  <button className="lq-ghost" onClick={() => setPhase("fit")}>← 다시 설정</button>
                </div>
              </>
            ) : (
              <>
                <hr className="lq-sep" />
                <p className="lq-row-text" style={{ fontWeight: 600 }}>이 핏을 다음에도 기억할까요?</p>
                <button className="lq-act" onClick={() => { setAcctMode("login"); setPhase("account"); }}>
                  로그인하고 기억하기
                </button>
                <div className="lq-ghost-row">
                  <button className="lq-ghost" onClick={saveQuietly}>이 브라우저에만 저장</button>
                  <span aria-hidden="true" style={{ color: "#c9c7bd" }}>·</span>
                  <button className="lq-ghost" onClick={onClose}>지금만 볼게요</button>
                </div>
                <div className="lq-ghost-row">
                  <button className="lq-ghost" onClick={() => setPhase("fit")}>← 다시 설정</button>
                </div>
              </>
            )}
          </>
        )}

        {phase === "result" && !complete && (
          <>
            <p className="lq-kicker">Smart Fit</p>
            <h3 className="lq-title">핏 프로필이 온전하지 않아요</h3>
            <p className="lq-sub">세 가지만 답하면 상품을 내 취향으로 볼 수 있어요.</p>
            <button className="lq-act" style={{ marginTop: 16 }} onClick={() => setPhase("fit")}>처음부터 설정하기</button>
          </>
        )}

        {phase === "account" && (
          <>
            <p className="lq-kicker">{acctMode === "login" ? "다음에도 기억하기" : "나의 N°1 시작하기"}</p>
            <h3 className="lq-title">{acctMode === "login" ? "로그인하고 핏 기억하기" : "계정 만들고 핏 기억하기"}</h3>
            <p className="lq-sub">방금 설정한 핏 프로필이 그대로 저장됩니다 — 다시 답할 필요가 없어요.</p>
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
                <button className="lq-ghost" onClick={() => setPhase("result")}>← 결과로</button>
              </div>
            </div>
          </>
        )}

        {phase === "confirm" && (
          <div className="lq-confirm">
            <p className="lq-confirm-mark">기억했어요</p>
            <p className="lq-confirm-sub">
              {confirmKind === "account"
                ? "계정에 저장됐어요 — 다음에도 이 핏으로 이어집니다."
                : "이 브라우저에 저장됐어요."}
            </p>
          </div>
        )}

        {(phase === "fit" || phase === "gender" || phase === "size") && (
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {phase !== "fit" && (
              <button className="lq-ghost" onClick={() => setPhase(phase === "size" ? "gender" : "fit")}>← 이전</button>
            )}
            <button className="lq-act" style={{ marginTop: 0 }}
              disabled={(phase === "fit" && !fit) || (phase === "gender" && !gender) || (phase === "size" && !sizeValue)}
              onClick={() => setPhase(nextOf(phase))}>
              다음 →
            </button>
          </div>
        )}
      </div>
    </LiquidSurface>
  );
}
