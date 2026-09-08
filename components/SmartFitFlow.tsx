"use client";
/**
 * N°1 Smart Fit — 단일 서페이스 플로우 (2026-09-08, LOGIN+SMART FIT 미션)
 *
 * 하나의 유리 서페이스가 단계별로 상태만 바뀐다: 질문 → 결과 → (게스트만) 저장 제안.
 *  - 프로필 보유 재진입자는 RESULT부터 (질문 무반복)
 *  - 게스트 결과: "이 핏을 다음에도 기억할까요?" → 로그인하고 저장 / 이 브라우저에만 저장 / 지금만
 *  - 로그인/회원가입은 같은 서페이스 안에서 — 탐색 컨텍스트 유지, 로그인 후 재입력 없음
 *  - 접근성: ESC, 포커스 트랩, 닫힌 뒤 열었던 컨트롤로 포커스 반환
 * 데이터 계약 변경 없음 — 기존 /api/auth(register/login) + FitProfile 스키마 그대로.
 */
import { useEffect, useRef, useState } from "react";
import { FIT_LABEL, eulReul, type FitProfile } from "@/lib/fit";

const TOP_SIZES = ["95(M)", "100(L)", "105(XL)", "110(2XL)", "FREE"];
const BOTTOM_SIZES = ["28~29", "30~31", "32~33", "34~35", "FREE"];
const FITS = [
  { v: "A", t: "스탠다드 핏", d: "체형에 깔끔하게 딱 맞는 단정한 정사이즈" },
  { v: "B", t: "세미오버 / 내추럴", d: "이너·하의는 정사이즈, 겉옷은 한 치수 여유" },
  { v: "C", t: "오버핏 / 와이드", d: "전체적으로 박시한 여유 있는 실루엣" },
];

type Phase = "q1" | "q2" | "q3" | "result" | "account";

export default function SmartFitFlow({
  initial,
  isLoggedIn,
  onSave,
  onAuthed,
  onClose,
}: {
  initial: FitProfile | null;
  isLoggedIn: boolean;
  onSave: (p: FitProfile) => void; // 저장(로그인: 계정 동기화 / 게스트: 브라우저 저장)
  onAuthed: (token: string, email: string, profile: FitProfile) => void; // 로그인/가입 완료 — 방금 만든 프로필과 함께
  onClose: () => void;
}) {
  const startPhase: Phase = initial ? "result" : "q1";
  const [phase, setPhase] = useState<Phase>(startPhase);
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

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // 접근성: ESC + 포커스 트랩 + 열렸을 때 초점 이동 + 닫힌 뒤 반환
  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((el) => !el.disabled);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const sizeOptions = category === "top" ? TOP_SIZES : BOTTOM_SIZES;
  const profile: FitProfile = { gender, size: size.replace(/\(.*\)/, ""), fit };
  const complete = Boolean(profile.gender && profile.size && profile.fit);

  const canNext = (p: Phase) => (p === "q1" ? !!gender : p === "q2" ? !!size : !!fit);

  const saveQuietly = () => { onSave(profile); onClose(); };

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
        // 로그인/가입 어떤 경로든 '방금 만든 핏 프로필'을 유지 — 재입력 없음
        onAuthed(data.token, email, profile);
        onClose();
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
    <div className="fit-modal-bg" onClick={onClose}>
      <div
        ref={panelRef}
        className="fit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="나에게 맞게 보기 — 핏 프로필"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="fit-close" onClick={onClose} aria-label="닫기">✕</button>

        {phase !== "account" && (
          <p className="fit-progress">
            {phase === "result" ? "내 핏 프로필" : `핏 설정 ${phase === "q1" ? "1" : phase === "q2" ? "2" : "3"}/3`}
          </p>
        )}

        {phase === "q1" && (
          <>
            <h3 className="fit-q">어떤 핏을 좋아하세요? 먼저 성별을 알려주세요</h3>
            <div className="fit-opts">
              {["남성", "여성"].map((g) => (
                <button key={g} className={`fit-opt ${gender === g ? "selected" : ""}`} onClick={() => setGender(g)}>
                  {g}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "q2" && (
          <>
            <h3 className="fit-q">평소 입는 기준 사이즈는?</h3>
            <div className="fit-cat-toggle">
              <button className={category === "top" ? "on" : ""} onClick={() => setCategory("top")}>상의</button>
              <button className={category === "bottom" ? "on" : ""} onClick={() => setCategory("bottom")}>하의</button>
            </div>
            <div className="fit-opts">
              {sizeOptions.map((s) => (
                <button key={s} className={`fit-opt ${size === s ? "selected" : ""}`} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "q3" && (
          <>
            <h3 className="fit-q">선호하는 핏은?</h3>
            <div className="fit-opts fit-vertical">
              {FITS.map((o) => (
                <button key={o.v} className={`fit-opt-v ${fit === o.v ? "selected" : ""}`} onClick={() => setFit(o.v)}>
                  <b>{o.t}</b>
                  <span>{o.d}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "result" && complete && (
          <div className="fit-result">
            <h3 className="fit-q">
              {FIT_LABEL[profile.fit]}{eulReul(FIT_LABEL[profile.fit] || "")} 선호하는 {profile.gender} 고객 기준,
              <br />평소 {profile.size}에 맞춰 보여드릴게요
            </h3>
            <p className="fit-result-body">
              정확한 호수는 상품마다 수치표가 공개된 것만 안내해 드려요.
              겉옷은{profile.fit === "B" || profile.fit === "C" ? " 취향에 따라 한 치수 이상 여유를 두고" : " 평소 사이즈 그대로"} 보시면 돼요.
            </p>
            {isLoggedIn ? (
              <div className="fit-btns">
                <button className="fit-prev" onClick={() => setPhase("q1")}>← 다시 설정</button>
                <button className="fit-next" onClick={saveQuietly}>내 계정에 저장</button>
              </div>
            ) : (
              <div className="fit-save">
                <p className="fit-save-q">이 핏을 다음에도 기억할까요?</p>
                <button className="fit-next" onClick={() => { setAcctMode("login"); setPhase("account"); }}>
                  로그인하고 저장
                </button>
                <div className="fit-save-sub">
                  <button className="fit-link" onClick={saveQuietly}>이 브라우저에만 저장</button>
                  <span aria-hidden="true">·</span>
                  <button className="fit-link" onClick={onClose}>지금만 볼게요</button>
                </div>
              </div>
            )}
            {!isLoggedIn && (
              <button className="fit-link fit-edit" onClick={() => setPhase("q1")}>← 다시 설정</button>
            )}
          </div>
        )}

        {phase === "result" && !complete && (
          <div className="fit-result">
            <h3 className="fit-q">핏 프로필이 온전하지 않아요</h3>
            <p className="fit-result-body">세 가지 질문에 답하면 상품을 내 취향으로 볼 수 있어요.</p>
            <div className="fit-btns">
              <button className="fit-next" onClick={() => setPhase("q1")}>처음부터 설정하기</button>
            </div>
          </div>
        )}

        {phase === "account" && (
          <div className="fit-acct">
            <h3 className="fit-q">{acctMode === "login" ? "로그인하고 핏 기억하기" : "계정 만들고 핏 기억하기"}</h3>
            <p className="fit-acct-note">방금 설정한 핏 프로필이 그대로 저장됩니다 — 다시 답할 필요가 없어요.</p>
            <input className="order-input" placeholder="이메일" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-label="이메일" />
            <input className="order-input" placeholder="비밀번호 (6자 이상)" type="password" value={pw}
              onChange={(e) => setPw(e.target.value)} aria-label="비밀번호" />
            {acctMode === "register" && (
              <input className="order-input" placeholder="비밀번호 확인" type="password" value={pw2}
                onChange={(e) => setPw2(e.target.value)} aria-label="비밀번호 확인" />
            )}
            {err && <p className="stock-alert">{err}</p>}
            <button className="fit-next" disabled={busy || !email || pw.length < 6 || (acctMode === "register" && pw !== pw2)}
              onClick={submitAccount}>
              {busy ? "확인 중..." : acctMode === "login" ? "로그인" : "가입하고 저장"}
            </button>
            <div className="fit-save-sub">
              <button className="fit-link" onClick={() => setAcctMode(acctMode === "login" ? "register" : "login")}>
                {acctMode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
              </button>
              <span aria-hidden="true">·</span>
              <button className="fit-link" onClick={() => setPhase("result")}>← 결과로 돌아가기</button>
            </div>
          </div>
        )}

        {phase !== "result" && phase !== "account" && (
          <div className="fit-btns">
            {phase !== "q1" && <button className="fit-prev" onClick={() => setPhase(phase === "q3" ? "q2" : "q1")}>← 이전</button>}
            <button className="fit-next" disabled={!canNext(phase)}
              onClick={() => setPhase(phase === "q1" ? "q2" : phase === "q2" ? "q3" : "result")}>
              다음 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
