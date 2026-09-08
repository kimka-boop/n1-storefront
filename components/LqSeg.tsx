"use client";
/**
 * LqSeg — Liquid Surface 안의 연속 재질 선택 컨트롤 (N1 Liquid Surface System)
 * 선택 시 새 카드가 생기는 게 아니라 재질의 밀도(thumb)가 이동한다(≈200ms).
 */
import type { CSSProperties } from "react";

export default function LqSeg({
  options, value, onChange, ariaLabel, vertical,
}: {
  options: { v: string; t: string; d?: string }[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  vertical?: boolean;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.v === value));
  const n = options.length;
  const thumb: CSSProperties = vertical
    ? { height: `calc((100% - 6px) / ${n})`, right: 3,
        transform: `translateY(${idx * 100}%)` }
    : { width: `calc((100% - 6px) / ${n})`,
        transform: `translateX(${idx * 100}%)` };
  return (
    <div className={`lq-seg ${vertical ? "lq-seg-v" : ""}`} role="group" aria-label={ariaLabel}>
      <span className="lq-seg-thumb" style={thumb} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={value === o.v ? "on" : ""}
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
        >
          {o.t}
          {o.d ? <span className="lq-seg-sub">{o.d}</span> : null}
        </button>
      ))}
    </div>
  );
}
