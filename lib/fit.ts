/**
 * N°1 Smart Fit V2 — 핏 해석 엔진 (2026-09-09, Smart Fit V2 미션)
 *
 * USER FIT CONTEXT + VERIFIED PRODUCT DATA + FIT RULES = INTERPRETATION.
 * LLM 호출 없이 순수 함수로 판단한다(§13). 고객 상호작용마다 호출되어도
 * 네트워크·비용이 없다.
 *
 * 원칙:
 *  - NEVER MANUFACTURE CERTAINTY — 확인된 데이터가 허용하는 범위까지만 개인화.
 *  - 결과는 PRODUCT FACT → YOUR CONTEXT → INTERPRETATION → LIMITATION 4층 (§15).
 *  - evidence: READY / PARTIAL / UNCONFIRMED / UNAVAILABLE (§14, runtime-derived).
 *  - 상의/하의 규칙 분리 (§17). 데이터에 없는 치수는 추정하지 않는다.
 *  - stretch 미확인 → 신축성 언급 금지 (§19). AI 이미지는 입력으로 받지 않는다 (§20).
 *  - 품절/재고 미확인 → 구매 제안처럼 표현하지 않는다 (§29).
 *
 * 데이터 현실(2026-09 기준 60 products): fit.shape는 의류 '종류' 코드(SHIRT 등),
 * 실루엣 키워드는 상품명에만 존재, sizeOptions는 전량 공란, sizeChart는 일부만 실측.
 * 따라서 실루엣은 상품명에서 파싱하고, 근거가 없으면 조용히 말하지 않는다.
 */
import type { FitContext, PreferredFit } from "./fitContext";

export { FIT_GENDER_PLACEHOLDER } from "./fitContext";
export type { FitContext, PreferredFit } from "./fitContext";

export const FIT_LABEL: Record<string, string> = {
  A: "정핏",
  B: "세미오버",
  C: "오버핏",
};

// 받침 유무에 따라 을/를 선택 (정핏→을, 세미오버→를)
export function eulReul(word: string): string {
  return (((word || " ").charCodeAt(word.length - 1) - 0xac00) % 28 > 0 ? "을" : "를");
}

export const GARMENT_KO: Record<string, string> = {
  SHIRT: "셔츠",
  TSHIRT: "티셔츠",
  SWEATSHIRT: "스웨터",
  JEANS: "청바지",
  JOGGER: "조거 팬츠",
  SLACKS: "슬랙스",
  CARGO: "카고 팬츠",
  KNIT: "니트",
  SKIRT: "스커트",
  SWEATPANTS: "트레이닝 팬츠",
};

const OUTER_KW = /(블루종|자켓|점퍼|가디건|코트|아우터|항공점퍼|패딩|야상)/i;
const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];
const NUM_TO_ALPHA: Record<string, string> = { "95": "S", "100": "L", "105": "XL", "110": "2XL" };

export function isOuterwear(name: string): boolean {
  return OUTER_KW.test(name || "");
}

/** 선호 기준 치수 보정 — A:+0 / B: 겉옷만 +1 / C: 겉옷 +2 · 이너 +1 (취향 산수, 상품 실측 아님) */
export function preferenceShift(name: string, fit: string): number {
  const outer = isOuterwear(name);
  if (fit === "B") return outer ? 1 : 0;
  if (fit === "C") return outer ? 2 : 1;
  return 0;
}

/** 상품 sizeOptions 안에서 선호 기준 사이즈 찾기 — 옵션에 없으면 "" (추측 금지) */
export function fitPresetSize(name: string, size: string, fit: string, sizeOptions: string[]): string {
  const raw = (size || "").replace(/\(.*\)/, "");
  if (!raw) return "";
  const base = NUM_TO_ALPHA[raw] || raw;
  let idx = SIZE_ORDER.indexOf(base);
  if (idx === -1) return "";
  idx = Math.max(0, Math.min(idx + preferenceShift(name, fit), SIZE_ORDER.length - 1));
  const target = SIZE_ORDER[idx];
  return (sizeOptions || []).find((o) => o.toUpperCase() === target) ?? "";
}

/* ════════════════════════════════════════════════════════════
 * V2 — 카테고리 · 실루엣 · 수치표 파싱
 * ════════════════════════════════════════════════════════════ */

export type GarmentKind = "top" | "bottom" | "accessory";

const ACCESSORY_KW = /(모자|버킷햇|볼캡|베레모|스카프|머플러|장갑|양말|목걸이|귀걸이|반지|주얼리)/;
const BOTTOM_NAME_KW = /(바지|팬츠|청바지|슬랙스|조거|스커트|치마)/;

/** 카테고리 판정 — 시트 category 우선, 이름 키워드 폴백. 모자류는 데이터 오분류라도 정직하게 accessory. */
export function categoryOf(product: { category?: string; name: string }): GarmentKind {
  if (ACCESSORY_KW.test(product.name || "")) return "accessory";
  const cat = (product.category || "").trim();
  if (cat.includes("하의")) return "bottom";
  if (cat.includes("상의")) return "top";
  if (BOTTOM_NAME_KW.test(product.name || "")) return "bottom";
  return "top";
}

const SILH_B_TEST = /세미\s*(오버|와이드)/;
const SILH_B_STRIP = /세미\s*(오버|와이드)/g;
const SILH_C_KW = /(오버|루즈|와이드|여유|박시|빅사이즈|빅핏|루스)/;
const SILH_A_KW = /(슬림|정핏|스키니|타이트|레귤러|일자|기본핏)/;

/**
 * 상품명에서 실루엣 방향 파싱. '세미와이드'가 '와이드'를 포함하므로 B어구를
 * 먼저 제거한 뒤 판정한다. 정핏·오버 단어가 동시에 있으면 충돌("mixed") —
 * 단정 대신 한계 문장으로 안전하게 떨어뜨린다(§35 CASE 13).
 */
export function silhouetteOf(name: string): "A" | "B" | "C" | "mixed" | null {
  const raw = (name || "").trim();
  if (!raw) return null;
  const hasB = SILH_B_TEST.test(raw);
  const rest = raw.replace(SILH_B_STRIP, " ");
  const c = SILH_C_KW.test(rest);
  const a = SILH_A_KW.test(rest);
  if (hasB) {
    if (a && c) return "mixed";
    return "B"; // 세미와이드/세미오버는 일자 표기보다 구체적인 의류 서술이 우선
  }
  if (a && c) return "mixed";
  if (c) return "C";
  if (a) return "A";
  return null;
}

/* ── 수치표 ── */

export interface ChartInfo {
  real: boolean; // 실측값이 있는 수치표 (UNKNOWN/공란 제외)
  labels: string[]; // 사이즈 행 라벨 — "95(XL)", "SIZE 30(29-31인치)", "FREE"…
  measures: string[]; // 표기된 측정 항목 (카테고리별)
  oneSize: boolean;
  heightRange: string; // "권장키 166-175" 등 상품이 직접 표기한 값만
}

const TOP_MEASURES = ["어깨", "가슴", "총장", "소매"];
const BOTTOM_MEASURES = ["허리", "엉덩이", "힙", "허벅지", "밑위", "밑단", "다리둘레", "총장"];

export function chartInfo(sizeChart?: string, category: GarmentKind = "top"): ChartInfo {
  const raw = (sizeChart || "").trim();
  const real = Boolean(raw) && !/^UNKNOWN/i.test(raw) && (/[:：]/.test(raw) || /\d+\s*cm|단면|둘레|총장/.test(raw));
  const labels = real
    ? raw
        .split(/\s*\/\s*|\s*\|\s*/)
        .map((seg) => seg.split(/[:：]/)[0].trim())
        .filter((l) => l && l.length <= 16)
    : [];
  const oneSize = labels.length > 0 && labels.every((l) => /FREE|1\s*size|원사이즈/i.test(l));
  const keys = category === "bottom" ? BOTTOM_MEASURES : TOP_MEASURES;
  const measures = keys.filter((k) => raw.includes(k));
  const h = raw.match(/권장\s*키\s*([\d\-~]+\s*cm|[\d\-~]+)/);
  return { real, labels, measures, oneSize, heightRange: h ? h[1] : "" };
}

/** 평소 사이즈 앵커가 수치표 행 라벨에 실제로 있는지 — 단어 경계 매칭(L⊂XL 오탐 방지). */
export function anchorInChart(chart: ChartInfo, size: string): string {
  const tokens = (size || "").split(/[^0-9A-Za-z가-힣]+/).filter((t) => t.length >= 1);
  if (!tokens.length) return "";
  for (const label of chart.labels) {
    for (const token of tokens) {
      const re = new RegExp(`(^|[^0-9A-Za-z])${token}([^0-9A-Za-z]|$)`);
      if (re.test(label)) return label;
    }
  }
  return "";
}

/* ── 소재 신축성 (§19 — 확인된 값만) ── */

export function stretchText(raw?: string): string {
  const v = (raw || "").trim();
  if (/^(있음|좋음|높음)$/.test(v)) return "신축성이 있는 편이에요";
  if (/^보통$/.test(v)) return "신축성은 보통이에요";
  if (/^약간$/.test(v)) return "신축성이 약간 있어요";
  if (/^없음$/.test(v)) return "신축성은 없는 편이에요";
  return ""; // UNKNOWN/공란/공급사 주석 — 아예 말하지 않는다
}

/* ════════════════════════════════════════════════════════════
 * V2 — interpretFit: 4층 결과 모델 (§15)
 * ════════════════════════════════════════════════════════════ */

export type EvidenceLevel = "READY" | "PARTIAL" | "UNCONFIRMED" | "UNAVAILABLE";

export interface FitProductInput {
  name: string;
  category?: string;
  fitShape?: string; // fit.shape — 의류 '종류' 코드
  stretch?: string; // fit.stretch 원문
  sizeChart?: string;
  sizeOptions?: string[];
  optionStock?: Record<string, number>;
  stockStatus?: string;
  modelInfo?: string;
}

export interface FitInterpretation {
  evidence: EvidenceLevel;
  category: GarmentKind;
  productFact: string; // 상품 자체의 확인된 정보
  yourContext: string; // 사용자가 알려준 선호
  interpretation: string; // 두 정보를 연결한 설명
  sizeHint?: string; // 수치표 anchor가 확인될 때만 — 사이즈 '행' 안내(단정 아님)
  limitation: string; // 현재 데이터로 확정할 수 없는 부분
  purchasable: boolean; // 재고가 확인된 상태만 true — 품절/미확인은 구매 제안 아님 (§29)
}

const RANK: Record<"A" | "B" | "C", number> = { A: 0, B: 1, C: 2 };

/** 프로필(컨텍스트)이 없으면 개인 해석 자체가 없다 — null (§35 CASE 14). */
export function interpretFit(
  product: FitProductInput,
  ctx: FitContext | null | undefined,
): FitInterpretation | null {
  if (!ctx || !ctx.preferredFit) return null;

  const category = categoryOf(product);
  const garment = GARMENT_KO[(product.fitShape || "").trim()] || "";
  const sil = category === "accessory" ? null : silhouetteOf(product.name);
  const chart = chartInfo(product.sizeChart, category);
  const stretch = stretchText(product.stretch);
  const userSize = (category === "bottom" ? ctx.bottomSize : ctx.topSize) || "";
  const catLabel = category === "bottom" ? "하의" : "상의";
  const soldOut = (product.stockStatus || "").trim() === "품절";
  const stockKnown = Boolean(product.optionStock && Object.keys(product.optionStock).length > 0);
  const purchasable = !soldOut && stockKnown;

  const prefLabel = FIT_LABEL[ctx.preferredFit] || "취향";
  const yourContext = `${prefLabel} 선호` + (userSize ? ` · 평소 ${catLabel} ${userSize}` : "");

  /* ── UNAVAILABLE: 핏 규칙이 성립하지 않는 대상 ── */
  if (category === "accessory") {
    return {
      evidence: "UNAVAILABLE",
      category,
      productFact: "이 상품은 일반 의류의 사이즈 체계가 적용되지 않는 소품이에요.",
      yourContext,
      interpretation: "핏 방향 안내 대신 착용 컷과 표기된 정보로 확인하는 게 정확해요.",
      limitation: "의류 핏 규칙이 적용되지 않아요.",
      purchasable,
    };
  }

  /* ── evidence 판정 (§14) ── */
  let evidence: EvidenceLevel;
  if (!sil && !chart.real) evidence = "UNCONFIRMED";
  else if (sil && sil !== "mixed" && chart.real && userSize) evidence = "READY";
  else evidence = "PARTIAL";

  /* ── PRODUCT FACT — 확인된 것만 (§19·§20: 미확인 소재·이미지로 추정 금지) ── */
  const factParts: string[] = [];
  if (garment) factParts.push(`종류는 ${garment}예요`);
  if (chart.real) {
    factParts.push(
      chart.measures.length
        ? `${chart.measures.join("·")} 실측이 수치표에 공개되어 있어요`
        : "실측 수치표가 공개되어 있어요",
    );
  }
  if (chart.oneSize) factParts.push("사이즈는 원사이즈 구성이에요");
  if (stretch) factParts.push(stretch);
  const model = (product.modelInfo || "").trim().replace(/착용$/, "");
  if (model && model.toUpperCase() !== "UNKNOWN") factParts.push(`모델 ${model} 착용 표기가 있어요`);
  if (chart.heightRange) factParts.push(`권장 키 ${chart.heightRange} 표기가 있어요`);
  if (!factParts.length) factParts.push("아직 확인된 핏 정보가 부족해요");
  const productFact = factParts.join(". ") + ".";

  /* ── INTERPRETATION — 방향 비교 (실루엣 근거가 있을 때만) ── */
  let interpretation: string;
  if (!sil) {
    interpretation = "이 상품의 실루엣 표기가 아직 확인 중이에요 — 착용 컷으로 먼저 봐주세요.";
  } else if (sil === "mixed") {
    interpretation = "상품 표기에 서로 다른 핏 단어가 섞여 있어 실루엣을 단정하지 않을게요.";
  } else {
    const diff = RANK[sil] - RANK[ctx.preferredFit];
    if (diff === 0) interpretation = "선호하시는 방향과 가까운 실루엣이에요.";
    else if (diff === 1) interpretation = "선호하시는 것보다 한 단계 여유가 있는 실루엣이에요.";
    else if (diff > 1) interpretation = "선호하시는 것보다 여유가 많은 실루엣이에요.";
    else if (diff === -1) interpretation = "선호하시는 것보다 몸에 닿는 실루엣이에요.";
    else interpretation = "꽤 몸에 닿는 실루엣이에요.";
  }

  /* ── SIZE HINT — READY에서만, 수치표에 실제 있는 행 기준 (§3: 확정 아닌 기준 안내) ── */
  let sizeHint: string | undefined;
  if (evidence === "READY" && !soldOut && userSize) {
    const anchor = anchorInChart(chart, userSize);
    if (anchor) {
      const shift = preferenceShift(product.name, ctx.preferredFit);
      const dir =
        shift === 0 ? "그 행" : shift === 1 ? "그다음(한 치수 여유) 행" : "그 위쪽(두 치수 여유) 행";
      sizeHint = `수치표에 평소 사이즈(${anchor}) 표기가 있어요 — ${dir}부터 비교해 보세요.`;
    }
  }

  /* ── LIMITATION — 현재 데이터로 확정할 수 없는 부분 (§28: 상태를 자연스럽게) ── */
  const lims: string[] = [];
  if (!chart.real) lims.push("실측 수치표가 아직 준비 중이라 호수는 확정해 드리기 어려워요 — 착용 컷과 함께 확인해 주세요");
  if (!userSize) lims.push("평소 사이즈를 알려주시면 더 가까이 안내할 수 있어요");
  if (sil === "mixed") lims.push("상품 표기의 핏 단어가 섞여 있어 신중한 확인이 필요해요");
  if (soldOut) lims.push("다만 지금은 품절 상태예요 — 참고용으로 봐주세요");
  if (!lims.length) lims.push("정확한 착용감은 수치표와 착용 컷으로 함께 확인해 주세요");
  const limitation = lims.join(". ") + ".";

  return { evidence, category, productFact, yourContext, interpretation, sizeHint, limitation, purchasable };
}
