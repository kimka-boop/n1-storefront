"use client";

/**
 * 소재 구성 표시 (Owner 지시 2026-09-07)
 * - 1번/2번 옵션별 소재를 줄바꿈으로 구분해 가독성 있게 표시
 * - "공급사 고지"는 본문에서 빼고 ⓘ 아이콘 hover/focus 시 아이콘 위치에 팝업
 * 스타일은 globals.css의 .mc-* 클래스 사용(PDP/모달 공용).
 */
import { parseMaterial } from "@/lib/display";

export default function MaterialComposition({
  material,
  compact = false,
}: {
  material?: string;
  compact?: boolean;
}) {
  const info = parseMaterial(material);
  if (!info) return null;

  return (
    <div className={`mc ${compact ? "mc-compact" : ""}`}>
      {info.lines.map((line, i) => (
        <p key={i} className="mc-line">
          {line.label ? <span className="mc-label">{line.label}</span> : null}
          <span className="mc-text">{line.text}</span>
        </p>
      ))}
      {info.hasNote ? (
        <span className="mc-note" tabIndex={0} aria-label={`공급사 고지: ${info.note}`}>
          <svg
            className="mc-icon"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" strokeLinecap="round" />
            <circle cx="12" cy="7.6" r="0.4" fill="currentColor" />
          </svg>
          <span className="mc-tip" role="tooltip">
            공급사 고지 — {info.note}
          </span>
        </span>
      ) : null}
    </div>
  );
}
