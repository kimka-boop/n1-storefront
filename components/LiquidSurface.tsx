"use client";
/**
 * N1 Liquid Surface — Sign Up · Login · Smart Fit 공용 유리 서페이스 래퍼
 * (2026-09-08, Liquid Glass Modal 미션)
 *
 * 하나의 연속 재질: 자식을 유리 카드로 쪼개지 않고, 콘텐츠(단계)가
 * 같은 재질 안에서 상태만 바뀐다(.lq-stage).
 *
 * 동작:
 *  - FORM: 420ms — 유리가 형성된다
 *  - DISSIPATE: 닫기 요청 시 480ms 자연 소멸 뒤 실제 언마운트
 *    (reduced-motion에서는 즉시)
 *  - ESC 닫기 · Tab 포커스 트랩 · 열릴 때 초점 이동 · 닫힌 뒤 열었던
 *    컨트롤로 초점 반환
 * 배경은 사라지지 않는다 — 스크림만으로 '조용히' 만든다.
 */
import { useEffect, useRef, useState, ReactNode } from "react";

export default function LiquidSurface({
  label,
  onClose,
  children,
  autoDissipateMs, // 짧은 확인(confirm) 뒤 스스로 소멸할 때 사용
}: {
  label: string;
  onClose: () => void; // 실제 언마운트 지시 (소멸 애니메이션 후 호출됨)
  children: ReactNode;
  autoDissipateMs?: number;
}) {
  const [dissipating, setDissipating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const closedRef = useRef(onClose);
  closedRef.current = onClose;

  useEffect(() => {
    openerRef.current = document.activeElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((el) => !el.disabled);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDissipating(true); return; }
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
  }, []);

  useEffect(() => {
    if (!dissipating) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => closedRef.current(), reduced ? 0 : 460);
    return () => clearTimeout(t);
  }, [dissipating]);

  // confirm 등 — 지정된 시간 뒤 스스로 소멸
  useEffect(() => {
    if (!autoDissipateMs) return;
    const t = setTimeout(() => setDissipating(true), autoDissipateMs);
    return () => clearTimeout(t);
  }, [autoDissipateMs]);

  return (
    <div
      className={`lq-backdrop ${dissipating ? "lq-out" : ""}`}
      onClick={() => setDissipating(true)}
    >
      <div
        ref={panelRef}
        className={`lq-surface ${dissipating ? "lq-dissipating" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="lq-close"
          aria-label="닫기"
          onClick={() => setDissipating(true)}
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
