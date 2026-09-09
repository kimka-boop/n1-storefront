/**
 * N°1 표시 계층 정규화 (2026-09-07 Owner 지시)
 *
 * 원칙: 시트(Source of Truth) 값을 "표시할 때만" 자연스러운 한국어로 바꾼다.
 * - 데이터를 변경하지 않는다(변경은 HERMES Master가 시트에서 수행).
 * - 시트가 새 문구로 업데이트되면 아래 매핑은 no-op이 된다(동일 문자열 그대로 통과).
 */

/** 성별 enum → 한국어 표기 (PDP 킥커 등) */
export function genderKo(gender?: string): string {
  const v = (gender || "").trim().toUpperCase();
  if (v === "MALE" || v === "남성" || v === "남자") return "남성";
  if (v === "FEMALE" || v === "여성" || v === "여자") return "여성";
  if (v === "GENDERLESS" || v === "젠더리스" || v === "남여공용" || v === "UNISEX") return "젠더리스";
  return "";
}

/** 성별 enum → 메인 필터 키 (API가 영어 enum을 반환해도 한글 값이 와도 동작) */
export function genderTabOf(gender?: string): "male" | "female" | "genderless" {
  const v = (gender || "").trim().toUpperCase();
  if (v === "MALE" || v === "남성" || v === "남자") return "male";
  if (v === "FEMALE" || v === "여성" || v === "여자") return "female";
  return "genderless";
}

/** 색상 표기 통일 — 겨자 → 머스타드 (코랄·아이보리와 동일한 외래어 원칙, Owner 지시) */
export function colorLabel(color: string): string {
  return color.replace(/겨자/g, "머스타드");
}

/** 교환·반품 문구 (Owner 승인 표기 — 시트 값이 새 문구면 그대로 통과) */
const QUALITY_OLD =
  "전자상거래 법에 규정되어 있는 소비자 청약철회 가능 범위를 준수합니다.";

/**
 * 승인 정책을 문장 단위 문단으로 분리 (Session I · TASK 15 — 줄바꿈/line-height 개선).
 * 문장 순서·표현은 승인 문구 그대로 — 정책 의미 변경 없음.
 * 시트가 새 문구를 내려주면 그 값은 문단 분리 없이 그대로 통과한다 (창작 금지).
 */
const QUALITY_NEW_PARAGRAPHS: readonly string[] = [
  "수령 후 7일 이내에 청약철회를 요청하실 수 있습니다.",
  "이미 사용했거나 훼손된 상품은 청약철회 대상에서 제외됩니다.",
  "전자상거래법상 소비자 청약철회 가능 범위를 준수합니다.",
];

const QUALITY_NEW = QUALITY_NEW_PARAGRAPHS.join(" ");

export function noticeQualityParagraphs(value?: string): string[] {
  const v = (value || "").trim();
  if (!v || v === QUALITY_OLD || v === QUALITY_NEW) {
    return [...QUALITY_NEW_PARAGRAPHS];
  }
  return [v];
}

export function noticeQualityText(value?: string): string {
  return noticeQualityParagraphs(value).join("\n\n");
}

/** 세탁 안내 — "상세 페이지 및 고객센터 문의" 보일러플레이트 문장 제거 (Owner 지시 2026-09-08) */
const WASH_BOILER =
  "세탁 관련 상세 정보는 상품 상세 페이지 및 고객센터로 문의 바랍니다.";

export function washingText(value?: string): string {
  const v = (value || "").trim();
  if (!v || v.toUpperCase() === "UNKNOWN") return "";
  return v
    .split(WASH_BOILER)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ");
}

/** 문의 안내 문구 (Owner 승인 표기 — 상단 유틸리티 문의 아이콘 위치 안내)
 *  2026-09-10 Storefront Repair: 하단 플로팅 FAB이 상단 분할 글래스 유틸리티로 이동함에 따라
 *  "페이지 하단 좌측 말풍선 아이콘" 안내는 더 이상 사실이 아니다 — 상단 기준으로 갱신. */
const AS_NEW =
  "N°1 고객센터 (상품 문의는 화면 상단의 문의 아이콘을 이용해 주세요)";

export function noticeAsText(value?: string): string {
  const v = (value || "").trim();
  if (!v || v.includes("문의하기 이용")) return AS_NEW;
  return v;
}

/** 카테고리 표기: "의류-상의" → "상의" */
export function categoryShort(category?: string): string {
  const v = (category || "").trim();
  if (!v) return "";
  const parts = v.split("-");
  return parts[parts.length - 1] || v;
}

/* ────────────────────────────────────────────────────────────
 * 소재 표기 파서 — 한 줄 나열을 구조화해 가독성 있게 표시한다.
 * 입력 예: "1번: 울60%+아크릴20%+나일론20% / 2번: 울50%+폴리에스테르35%+나일론15% (공급사 고지: 1번과 2번은 소재혼용액이 다릅니다)"
 * ──────────────────────────────────────────────────────────── */

export interface MaterialLine {
  label: string; // "1번" | "2번" | ""
  text: string; // "울 60% · 아크릴 20% · 나일론 20%"
}

export interface MaterialInfo {
  lines: MaterialLine[];
  note: string; // "공급사 고지 — ..." (없으면 "")
  hasNote: boolean;
}

/** "울60%+아크릴20%" → "울 60% · 아크릴 20%" */
function formatPercentages(chunk: string): string {
  return chunk
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\s*%\s*/g, "% ").replace(/(\d)%\s*$/, "$1%").trim())
    .map((s) => s.replace(/(\S+?)\s*([0-9]+(?:\.[0-9]+)?)%/, "$1 $2%"))
    .join(" · ");
}

export function parseMaterial(raw?: string): MaterialInfo | null {
  const v = (raw || "").trim();
  if (!v || v.toUpperCase() === "UNKNOWN") return null;

  let body = v;
  let note = "";
  // 괄호 안 "공급사 고지: ..." 추출 (툴팁으로 이동 표시)
  const noteMatch = body.match(/\(([^)]*공급사[^)]*)\)/);
  if (noteMatch) {
    note = noteMatch[1].trim();
    body = body.replace(noteMatch[0], "").trim();
  }
  body = body.replace(/\s{2,}/g, " ").replace(/[,\/\s]+$/, "").trim();

  const lines: MaterialLine[] = [];
  for (const seg of body.split("/")) {
    const s = seg.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*번\s*[:：]?\s*(.+)$/);
    if (m) {
      lines.push({ label: `${m[1]}번`, text: formatPercentages(m[2]) });
    } else {
      lines.push({ label: "", text: formatPercentages(s) });
    }
  }
  if (!lines.length) return null;
  return {
    lines,
    note: note ? note.replace(/^공급사\s*고지\s*[:：]\s*/, "") : "",
    hasNote: Boolean(note),
  };
}

/** 한 줄 요약 텍스트(모달 등 좁은 공간) */
export function materialText(raw?: string): string {
  const info = parseMaterial(raw);
  if (!info) return "";
  return info.lines
    .map((l) => (l.label ? `${l.label} ${l.text}` : l.text))
    .join(" / ");
}

/** 치수 요약 — "1번(88까지) · 2번(99까지)" 형태로 라벨만 추출 */
export function sizeSummary(sizeChart?: string): string {
  const v = (sizeChart || "").trim();
  if (!v) return "";
  const labels = v.match(/\d+\s*번\s*\([^)]*\)/g);
  if (labels && labels.length) return labels.map((s) => s.replace(/\s+/g, "")).join(" · ");
  return "실측치 공개";
}
