"use client";
/**
 * N°1 — Garment Blueprint SVG (SMART FIT First Meeting)
 *
 * 사람 신체 실루엣이 아닌 "의류 스펙 다이어그램" — 상의/하의 가먼트 아웃라인.
 * 단색 ink line 1.4px, 도면 느낌. cartoon/3D/캐릭터 금지.
 *
 * 입력과 시각 반응의 인과관계:
 *  - size(M→XL): 상의 폭/길이 미세 증가 (UI feedback — 실측 시각화 아님)
 *  - fit A/B/C: A=타이트 → C=완화 (silhouette scaleX)
 *  - gender: proportion 미세 변화만 (고정관념적 연출 금지)
 *
 * LOW DATA / reduced-motion: 전환 애니메이션 0 (즉시 스냅 — CSS transition 미적용)
 */
import { useId } from "react";

export interface BlueprintState {
  gender: string;              // "남성" | "여성" | ""
  category: "top" | "bottom";
  size: string;                // "100(L)" 등
  fit: string;                 // "A" | "B" | "C" | ""
  animated: boolean;           // false → 즉시 스냅
}

// 사이즈 인덱스 → garment 폭 배율 (UI feedback용, 실측 아님)
function sizeRatio(size: string): number {
  const m = size.match(/(\d{2,3})/);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  // 95→0.94, 100→1.0, 105→1.06, 110→1.12 (선형)
  return 0.94 + ((n - 100) / 5) * 0.06;
}
const FIT_SCALE: Record<string, number> = { A: 0.96, B: 1.0, C: 1.06 };

const TRANS = (animated: boolean) =>
  animated ? "transition: all .8s cubic-bezier(.22,.61,.36,1);" : "";

/** 상의 가먼트 아웃라인 (정면 도면 스타일) */
export function TopBlueprint({ state }: { state: BlueprintState }) {
  const uid = useId().replace(/:/g, "");
  const sr = sizeRatio(state.size || "100");
  const fs = FIT_SCALE[state.fit] ?? 1;
  const w = 180 * sr * fs;          // 셔츠 폭
  const shoulder = w * 0.92;
  const len = 240 * (0.96 + (sr - 1) * 0.5);
  const cx = 100;
  const x0 = cx - w / 2;

  return (
    <svg viewBox="0 0 200 300" width="100%" height="100%" role="img"
      aria-label={`상의 실루엣 도면 — 사이즈 ${state.size || "미선택"}, 핏 ${state.fit || "미선택"}`}
      style={{ maxWidth: 190, maxHeight: 280 }}>
      {/* 카라 + 플래킷 라인 — 도면 디테일 */}
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
         style={{ transition: state.animated ? "all .8s cubic-bezier(.22,.61,.36,1)" : "none" }}>
        {/* 몸통 아웃라인 */}
        <path
          d={`M ${cx - shoulder / 2} ${70} L ${x0} ${100} L ${x0} ${70 + len} L ${x0 + w} ${70 + len} L ${x0 + w} 100 L ${cx + shoulder / 2} 70 L ${cx + 14} 62 L ${cx} 76 L ${cx - 14} 62 Z`}
        />
        {/* 카라 */}
        <path d={`M ${cx - 14} 62 L ${cx - 22} 52 L ${cx - 6} 46 L ${cx} 56 L ${cx + 6} 46 L ${cx + 22} 52 L ${cx + 14} 62`} />
        {/* 플래킷 중앙선 + 단추 */}
        <line x1={cx} y1={78} x2={cx} y2={70 + len - 14} strokeDasharray="1 0" opacity=".55" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={cx} cy={96 + i * ((len - 40) / 4)} r="2.2" opacity=".7" />
        ))}
        {/* 치수 안내선 (도면 언어) — 사이즈 선택 시 늘어나는 선 */}
        <g opacity=".38" strokeWidth="1">
          <line x1={x0} y1={70 + len + 18} x2={x0 + w} y2={70 + len + 18} />
          <line x1={x0} y1={70 + len + 14} x2={x0} y2={70 + len + 22} />
          <line x1={x0 + w} y1={70 + len + 14} x2={x0 + w} y2={70 + len + 22} />
          <text x={cx} y={70 + len + 34} textAnchor="middle" fontSize="11"
            fill="currentColor" stroke="none" fontFamily="ui-monospace, monospace">
            {state.size ? state.size.replace(/\(|\)/g, " ") : "— —"}
          </text>
        </g>
        {/* 핏 라벨 */}
        <text x={cx} y={44} textAnchor="middle" fontSize="10" letterSpacing="2"
          fill="currentColor" stroke="none" fontFamily="ui-sans-serif">
          {state.fit ? { A: "STANDARD FIT", B: "SEMI-OVER", C: "OVER / WIDE" }[state.fit as "A"|"B"|"C"] || "" : "FIT —"}
        </text>
      </g>
    </svg>
  );
}

/** 하의 가먼트 아웃라인 (정면 도면 스타일) */
export function BottomBlueprint({ state }: { state: BlueprintState }) {
  const sr = sizeRatio((state.size || "32").replace(/[^\d]/g, "") ? state.size : "32");
  const fs = FIT_SCALE[state.fit] ?? 1;
  const w = 150 * sr * fs;
  const len = 210 * (0.96 + (sr - 1) * 0.4);
  const cx = 100;
  const x0 = cx - w / 2;

  return (
    <svg viewBox="0 0 200 300" width="100%" height="100%" role="img"
      aria-label={`하의 실루엣 도면 — 사이즈 ${state.size || "미선택"}, 핏 ${state.fit || "미선택"}`}
      style={{ maxWidth: 190, maxHeight: 280 }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
         style={{ transition: state.animated ? "all .8s cubic-bezier(.22,.61,.36,1)" : "none" }}>
        {/* 허리밴드 + 몸통 */}
        <rect x={x0} y={64} width={w} height={18} />
        <path d={`M ${x0} 82 L ${x0} ${82 + len} L ${cx - 4} ${82 + len} L ${cx - 2} ${82 + len * 0.52} L ${cx} ${82 + len * 0.3} L ${cx + 2} ${82 + len * 0.52} L ${cx + 4} ${82 + len} L ${x0 + w} ${82 + len} L ${x0 + w} 82 Z`} />
        {/* 스트링 */}
        <path d={`M ${cx - 10} 73 Q ${cx} 79 ${cx + 10} 73`} opacity=".6" />
        {/* 치수 안내선 */}
        <g opacity=".38" strokeWidth="1">
          <line x1={x0} y1={64 - 12} x2={x0 + w} y2={64 - 12} />
          <line x1={x0} y1={64 - 16} x2={x0} y2={64 - 8} />
          <line x1={x0 + w} y1={64 - 16} x2={x0 + w} y2={64 - 8} />
          <text x={cx} y={64 - 20} textAnchor="middle" fontSize="11"
            fill="currentColor" stroke="none" fontFamily="ui-monospace, monospace">
            {state.size || "— —"}
          </text>
        </g>
        <text x={cx} y={44} textAnchor="middle" fontSize="10" letterSpacing="2"
          fill="currentColor" stroke="none" fontFamily="ui-sans-serif">
          {state.fit ? { A: "STANDARD FIT", B: "SEMI-OVER", C: "OVER / WIDE" }[state.fit as "A"|"B"|"C"] || "" : "FIT —"}
        </text>
      </g>
    </svg>
  );
}
