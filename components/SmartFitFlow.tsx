"use client";
/**
 * N°1 — SMART FIT First Meeting Flow (Prototype)
 *
 * 철학: "내가 정보를 하나 입력할 때마다 N°1이 나를 조금씩 이해하고 있다."
 *  - 선택 → 즉각 시각 반응 → 누적 프로필 변화 (인과관계)
 *  - EN = 브랜드/기능/상태 라벨, KR = 질문/설명/배려
 *
 * 흐름:
 *  신규 비로그인: ENTRY → Q1 → Q2 → Q3 → RESULT → (선택) ACCOUNT(회원가입)
 *  로그인 사용자: RESULT부터 (수정하기)
 *  완료한 비로그인: RESULT부터 (이대로 시작하기 / 계정에 저장)
 *
 * 데이터 스키마/localStorage/register API 계약 — 전부 기존 그대로 (변경 0)
 * LOW DATA / prefers-reduced-motion → 모든 transition 즉시 스냅
 */
import { useEffect, useMemo, useState } from "react";
import { prefersReducedMotion, isLowData } from "@/lib/proto";
import { TopBlueprint, BottomBlueprint } from "./SilhouetteSVG";

export interface FitProfile { gender: string; size: string; fit: string; }

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];
const FITS = [
  { v: "A", t: "STANDARD", kr: "스탠다드 핏", d: "체형에 깔끔하게 딱 맞는 단정한 정사이즈" },
  { v: "B", t: "SEMI-OVER", kr: "세미오버 / 내추럴 ⭐", d: "이너·하의는 정사이즈, 자켓은 1치수 여유 (기본 추천)" },
  { v: "C", t: "OVER / WIDE", kr: "오버핏 / 와이드", d: "전체적으로 박시한 스트릿·트렌디 핏" },
];

type Phase = "q1" | "q2" | "q3" | "result" | "account" | "done";

export interface PendingCredentials { email: string; password: string; }

export default function SmartFitFlow({
  initial,
  isLoggedIn,
  userEmail,
  pendingCredentials,   // 회원가입 먼저 입력한 계정 정보 (메모리 보관 — localStorage/URL 저장 금지)
  onSave,
  onRegister,
  onRegistered,
  onClose,
}: {
  initial: FitProfile | null;
  isLoggedIn: boolean;
  userEmail: string | null;
  pendingCredentials?: PendingCredentials | null;
  onSave: (p: FitProfile) => void;
  onRegister: (email: string, pw: string, profile: FitProfile) => Promise<{ ok: boolean; error?: string; token?: string; profile?: FitProfile }>;
  onRegistered: (token: string, email: string, profile: FitProfile) => void;
  onClose: () => void;
}) {
  // 재진입자(프로필 보유)는 RESULT부터 — 3문항 무반복
  const [phase, setPhase] = useState<Phase>(pendingCredentials ? "q1" : initial ? "result" : "q1");
  const [gender, setGender] = useState(initial?.gender || "");
  const [category, setCategory] = useState<"top" | "bottom">("top");
  const [size, setSize] = useState(initial?.size || "");
  const [fit, setFit] = useState(initial?.fit || "");
  const [animated, setAnimated] = useState(true);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // LOW DATA / reduced-motion → 즉시 스냅 (전환 애니메이션 0)
    if (prefersReducedMotion() || isLowData()) setAnimated(false);
  }, []);

  const toggleLowData = () => {
    const v = !isLowData();
    localStorage.setItem("n1_lowdata", v ? "1" : "0");
    if (v) setAnimated(false); else if (!prefersReducedMotion()) setAnimated(true);
  };

  const sizeOptions = category === "top" ? TOP_SIZES : BOTTOM_SIZES;
  const bp = useMemo(() => ({ gender, category, size, fit, animated }), [gender, category, size, fit, animated]);
  const profile: FitProfile = { gender, size: size.replace(/\(.*\)/, ""), fit };

  const pick = (fn: () => void, delay = 450) => {
    fn();
    if (!animated) { setPhase((ph) => (ph === "q1" ? "q2" : ph === "q2" ? "q3" : ph === "q3" ? "result" : ph) as Phase); return; }
    // 선택 → 카드 반응을 잠깐 보여준 뒤 다음 단계 (narrative 800ms 내 완결)
    setTimeout(() => setPhase((ph) => (ph === "q1" ? "q2" : ph === "q2" ? "q3" : ph === "q3" ? "result" : ph) as Phase), delay);
  };

  // ── 수정1: Q3 전용 전환 — 선택 반응(실루엣 변형)이 800ms silhouette transition 완료 후
  //    안정 구간까지 보이도록 RESULT 전환을 연장. LOW DATA/reduced-motion은 즉시.
  const pickFit = (v: string) => {
    setFit(v);
    if (!animated) { setPhase("result"); return; }
    // silhouette transition .8s + 안정 구간 → 총 1,450ms 후 RESULT
    setTimeout(() => setPhase((ph) => (ph === "q3" ? "result" : ph) as Phase), 1450);
  };

  // ── 수정5: RESULT 추천 예시 — smartFitPreset과 동일한 SIZE_ORDER/보정 규칙으로 실계산
  // (아우터 기준 예시: B=+1치수, C=+2치수 — page.tsx smartFitPreset의 규칙과 동일)
  const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];
  const NUM_TO_ALPHA: Record<string, string> = { "95": "S", "100": "L", "105": "XL", "110": "2XL" };
  const recExample = (() => {
    if (!size || !fit || size === "FREE") return "";
    const baseAlpha = NUM_TO_ALPHA[size.replace(/\(.*\)/, "")] || size.replace(/\(.*\)/, "");
    let baseIdx = SIZE_ORDER.indexOf(baseAlpha);
    if (baseIdx === -1) return "";
    // 아우터 예시: B=+1, C=+2 (smartFitPreset 규칙과 동일)
    const targetIdx = fit === "B" ? baseIdx + 1 : fit === "C" ? baseIdx + 2 : baseIdx;
    const final = SIZE_ORDER[Math.max(0, Math.min(targetIdx, SIZE_ORDER.length - 1))];
    return `예: 아우터는 ${final}을 추천해 드려요`;
  })();

  const chips = [
    gender && { k: "GENDER", v: gender === "남성" ? "MALE" : "FEMALE" },
    size && { k: category === "top" ? "TOP" : "BOTTOM", v: size.replace(/\(|\)/g, "") },
    fit && { k: "FIT", v: { A: "STANDARD", B: "SEMI-OVER", C: "OVER" }[fit as "A"|"B"|"C"] },
  ].filter(Boolean) as { k: string; v: string }[];

  const doRegister = async () => {
    if (pw.length < 6) { setErr("비밀번호는 6자 이상"); return; }
    if (pw !== pw2) { setErr("비밀번호가 일치하지 않습니다"); return; }
    setBusy(true); setErr("");
    try {
      const data = await onRegister(email, pw, profile);
      if (data.ok && data.token) {
        onRegistered(data.token, email, data.profile || profile);
        setPhase("done");
      } else {
        setErr(data.error || "가입 실패 — 잠시 후 다시 시도해주세요");
      }
    } catch { setErr("서버 연결 실패"); }
    setBusy(false);
  };

  const Bp = category === "top" ? TopBlueprint : BottomBlueprint;

  return (
    <div className="fit-modal-bg" onClick={onClose} role="dialog" aria-modal="true" aria-label="SMART FIT 설정">
      <div className={`sf-flow ${animated ? "" : "sf-snap"}`} onClick={(e) => e.stopPropagation()}>
        <button className="fit-close" onClick={onClose} aria-label="닫기">✕</button>

        {/* ── 진행 인디케이터 (항상 표시) ── */}
        <div className="sf-progress" role="progressbar"
          aria-valuenow={phase === "q1" ? 1 : phase === "q2" ? 2 : phase === "q3" ? 3 : 3}
          aria-valuemin={1} aria-valuemax={3}
          aria-label={`스마트 핏 설정 ${phase === "q1" ? 1 : phase === "q2" ? 2 : 3}단계 / 3`}>
          <span className="sf-progress-label">SMART FIT {phase !== "result" && phase !== "account" && phase !== "done" ? `${phase === "q1" ? 1 : phase === "q2" ? 2 : 3}/3` : ""}</span>
          <button className="proto-lowdata" onClick={toggleLowData} aria-pressed={isLowData()}>
            LOW DATA {isLowData() ? "ON" : "OFF"}
          </button>
          <span className="sf-progress-bar" aria-hidden="true">
            <i style={{ width: phase === "q1" ? "33%" : phase === "q2" ? "66%" : "100%" }} />
          </span>
        </div>

        {/* ── 라이브 영역: 현재 질문/결과 (스크린리더 안내) ── */}
        <div aria-live="polite" className="sf-live">
          {/* ═══ Q1 성별 ═══ */}
          {phase === "q1" && (
            <div className="sf-step" role="radiogroup" aria-label="성별 선택">
              <div className="sf-blueprint"><Bp state={bp} /></div>
              <h3 className="sf-q">성별을 알려주세요</h3>
              <p className="sf-why">성별에 따라 사이즈 체계가 달라져서, 정확한 추천을 위해 필요해요.</p>
              <div className="sf-tiles">
                {["남성", "여성"].map((g) => (
                  <button key={g} role="radio" aria-checked={gender === g}
                    className={`sf-tile ${gender === g ? "on" : ""}`}
                    onClick={() => pick(() => setGender(g))}>
                    <b>{g === "남성" ? "MEN" : "WOMEN"}</b><span>{g}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Q2 사이즈 ═══ */}
          {phase === "q2" && (
            <div className="sf-step" role="radiogroup" aria-label="기준 사이즈 선택">
              <div className="sf-blueprint"><Bp state={bp} /></div>
              <h3 className="sf-q">평소 입는 기준 사이즈는?</h3>
              <p className="sf-why">이 사이즈를 기준으로 핏 취향에 맞춰 추천해드립니다.</p>
              <div className="sf-cat" role="tablist" aria-label="상의/하의">
                {(["top", "bottom"] as const).map((c) => (
                  <button key={c} role="tab" aria-selected={category === c}
                    className={`sf-cat-btn ${category === c ? "on" : ""}`}
                    onClick={() => { setCategory(c); setSize(""); }}>
                    {c === "top" ? "상의 TOP" : "하의 BOTTOM"}
                  </button>
                ))}
              </div>
              <div className="sf-sizes">
                {sizeOptions.map((s) => (
                  <button key={s} role="radio" aria-checked={size === s}
                    className={`sf-size ${size === s ? "on" : ""}`}
                    onClick={() => pick(() => setSize(s), 650)}>
                    {s}
                  </button>
                ))}
              </div>
              <button className="sf-prev" onClick={() => setPhase("q1")}>← 이전</button>
            </div>
          )}

          {/* ═══ Q3 핏 ═══ */}
          {phase === "q3" && (
            <div className="sf-step" role="radiogroup" aria-label="핏 취향 선택">
              <div className="sf-blueprint"><Bp state={bp} /></div>
              <h3 className="sf-q">어떤 핏을 좋아하시나요?</h3>
              <p className="sf-why">같은 사이즈라도 핏에 따라 추천 치수가 달라집니다.</p>
              <div className="sf-fits">
                {FITS.map((o) => (
                  <button key={o.v} role="radio" aria-checked={fit === o.v}
                    className={`sf-fit ${fit === o.v ? "on" : ""}`}
                    onClick={() => pickFit(o.v)}>
                    <b>{o.kr}</b><span>{o.d}</span>
                  </button>
                ))}
              </div>
              <button className="sf-prev" onClick={() => setPhase("q2")}>← 이전</button>
            </div>
          )}

          {/* ═══ RESULT — YOUR FIT PROFILE ═══ */}
          {phase === "result" && (
            <div className="sf-step sf-result">
              <div className="sf-blueprint done">
                {category === "top" || !size ? <TopBlueprint state={{ ...bp, category: "top" }} /> : <BottomBlueprint state={bp} />}
              </div>
              <p className="sf-result-label">YOUR FIT PROFILE</p>
              <div className="sf-chips" aria-label="입력하신 정보">
                {chips.map((c) => (
                  <span key={c.k} className={`sf-chip sf-chip-in`}>
                    <em>{c.k}</em>{c.v}
                  </span>
                ))}
              </div>
              <p className="sf-care">
                이제 N°1이 상품을 보여드릴 때,<br />당신에게 맞는 사이즈를 먼저 알려드릴게요.
              </p>
              {recExample && <p className="sf-rec-example">{recExample}</p>}
              <div className="sf-actions">
                {pendingCredentials ? (
                  /* 회원가입 먼저 — RESULT에서 최종 가입 */
                  <button className="sf-primary" disabled={busy}
                    onClick={async () => {
                      setBusy(true); setErr("");
                      try {
                        const data = await onRegister(pendingCredentials.email, pendingCredentials.password, profile);
                        if (data.ok && data.token) {
                          onRegistered(data.token, pendingCredentials.email, data.profile || profile);
                          setPhase("done");
                        } else setErr(data.error || "가입 처리 중 오류가 발생했습니다");
                      } catch { setErr("서버 연결 실패"); }
                      setBusy(false);
                    }}>
                    {busy ? "가입 중…" : "가입 완료하기"}
                  </button>
                ) : (
                  <>
                    <button className="sf-primary" onClick={() => { onSave(profile); setPhase(isLoggedIn ? "done" : "account"); }}>
                      이대로 시작하기
                    </button>
                    {!isLoggedIn && (
                      <button className="sf-ghost" onClick={() => { onSave(profile); setPhase("account"); }}>
                        내 Smart Fit을 저장할게요
                      </button>
                    )}
                    <button className="sf-ghost" onClick={() => setPhase("q1")}>다시 설정</button>
                    {!isLoggedIn && (
                      <p className="sf-alt">다른 기기에서도 내 추천을 이어갈 수 있어요.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ═══ ACCOUNT — 내 Smart Fit을 저장할게요 ═══ */}
          {phase === "account" && (
            <div className="sf-step sf-account">
              <p className="sf-result-label">SAVE YOUR PROFILE</p>
              <p className="sf-care sm">
                방금 만든 FIT PROFILE을 계정에 저장하면<br />다른 기기에서도 같은 추천을 받을 수 있어요.
              </p>
              <input className="order-input" type="email" placeholder="이메일" aria-label="이메일"
                value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <input className="order-input" type="password" placeholder="비밀번호 (6자 이상)" aria-label="비밀번호"
                value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              <input className="order-input" type="password" placeholder="비밀번호 확인" aria-label="비밀번호 확인"
                value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              {err && <p className="stock-alert" role="alert">{err}</p>}
              <button className="sf-primary" disabled={busy || !email || !pw || !pw2} onClick={doRegister}>
                {busy ? "저장 중…" : "회원가입 + FIT PROFILE 저장"}
              </button>
              <button className="sf-ghost" onClick={() => setPhase("done")}>지금은 건너뛰기</button>
            </div>
          )}

          {/* ═══ DONE ═══ */}
          {phase === "done" && (
            <div className="sf-step sf-done">
              <div className="sf-done-check" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="52" height="52">
                  <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M15 24.5 L21.5 31 L33 18.5" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" className={animated ? "sf-check-path" : ""} />
                </svg>
              </div>
              <p className="sf-result-label">SAVED</p>
              {userEmail && (
                <p className="sf-care" style={{ fontWeight: 700 }}>
                  {userEmail.split("@")[0]}님에게 맞는 추천을 준비했어요.
                </p>
              )}
              <p className="sf-care">이제 상품을 보여드릴 때<br />추천 사이즈를 먼저 알려드릴게요.</p>
              <button className="sf-primary" onClick={onClose}>N°1 상품 탐색 →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
