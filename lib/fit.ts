/**
 * N°1 Smart Fit — 핏 해석 엔진 (2026-09-08, LOGIN+SMART FIT 미션)
 *
 * 원칙: 상품에 실측 실루엣 데이터가 없으므로( fit.shape는 의류 '종류' 코드),
 * 모든 개인화 문장은 '사용자 취향 기준 안내'로만 말한다.
 * 근거 없는 정밀 추천(호수 단정, 점수, 확률)은 만들지 않는다.
 */

export interface FitProfile {
  gender: string;
  size: string;
  fit: string; // "A" 정핏 | "B" 세미오버 | "C" 오버핏
}

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

export interface FitGuidance {
  fact: string; // 상품 사실 — 확인된 것만
  preference: string; // 개인 해석 — 취향 기준임을 명시
  note: string; // 불확실성 — 수치표 유무 기반
}

/** FACT → PERSONAL INTERPRETATION 순서. 프로필 없으면 null (해석 없음). */
export function fitGuidance(
  product: { name: string; fitShape?: string; sizeChart?: string },
  profile: FitProfile | null,
): FitGuidance | null {
  if (!profile || !profile.size) return null;
  const hasChart = Boolean((product.sizeChart || "").trim());
  const garment = GARMENT_KO[(product.fitShape || "").trim()] || "";
  const chartSentence = hasChart ? "수치표가 공개되어 있어요." : "수치표는 아직 확인 중이에요.";
  const fact = garment ? `이 상품의 종류는 ${garment}이고, ${chartSentence}` : chartSentence;

  const label = FIT_LABEL[profile.fit] || "취향";
  const shift = preferenceShift(product.name, profile.fit || "");
  let preference = `평소 ${profile.size} 기준에 ${label}${eulReul(label)} 선호하시네요.`;
  preference +=
    shift > 0
      ? ` 이런 상품은 평소보다 ${shift === 1 ? "한 치수" : "두 치수"} 크게 보시면 취향에 가까워요.`
      : " 평소 사이즈 기준으로 보시면 취향에 가까워요.";

  const note = hasChart
    ? "정확한 호수는 위 수치표와 함께 확인해 주세요."
    : "정확한 호수를 말씀드리긴 어려워요 — 수치표가 공개되면 함께 확인해 주세요.";
  return { fact, preference, note };
}
