/**
 * N°1 Products 카탈로그 — Sheets Products 시트 읽기 공용 계층
 * /api/products 와 AI CS(/api/chat)가 동일한 검증된 상품 데이터를 사용한다 (미션 §22.B, §39).
 */
import { getDoc } from "@/lib/sheets";

export interface CatalogProduct {
  id: string;
  name: string;
  gender: string;
  category: string;
  price: number;
  stockStatus: string;
  lookbookStatus: string;
  lookbookImage: string;
  lookbookDrive: string;
  lookbookLocal: string;
  material: string;
  washingInfo: string;
  sizeChart: string;
  modelInfo: string;
  fit: { thickness: string; stretch: string; sheer: string; lining: string; shape: string };
  origin: string;
  notice: { manufacturer: string; madeAt: string; colorSize: string; quality: string; as: string };
  colorOptions: string[];
  sizeOptions: string[];
  optionStock: Record<string, number>;
  /** 왜 이 제품인가 — 소싱 파이프라인이 생성(§30), 시트 선정이유 컬럼 */
  whyThisProduct: string;
  /** 근거 출처 (§29): SUPPLIER / HERMES_MD / MATERIAL_GUIDANCE / SUPPLIER_HTML / UNKNOWN */
  materialSource: string;
  careSource: string;
  measurementSource: string;
  stockSource: string;
  whySource: string;
}

const UNKNOWN = (v: string | null, fallback = "UNKNOWN"): string => {
  const s = (v || "").trim();
  return s ? s : fallback;
};

export async function fetchCatalog(): Promise<CatalogProduct[]> {
  const doc = await getDoc();
  const sheet = doc.sheetsByIndex[0]; // Products
  const rows = await sheet.getRows();
  return rows.map((r) => ({
    id: r.get("상품ID") || "",
    name: r.get("상품명") || "",
    gender: r.get("성별") || r.get("gender") || "",
    category: r.get("카테고리") || "",
    price: Number(String(r.get("판매가") || "0").replace(/[^\d]/g, "")) || 0,
    stockStatus: r.get("재고상태") || "",
    lookbookStatus: r.get("룩북상태") || "",
    lookbookImage: r.get("룩북이미지URL") || "",
    lookbookDrive: (r.get("룩북이미지URL") || "").startsWith("https://drive.google.com") ? r.get("룩북이미지URL") : "",
    lookbookLocal: (r.get("룩북이미지URL") || "").startsWith("lookbook/") ? r.get("룩북이미지URL") : "",
    material: r.get("소재") || "",
    washingInfo: r.get("세탁정보") || "",
    sizeChart: r.get("실측사이즈") || "",
    modelInfo: r.get("모델정보") || "",
    fit: {
      thickness: r.get("두께감") || "",
      stretch: r.get("신축성") || "",
      sheer: r.get("비침") || "",
      lining: r.get("안감") || "",
      shape: r.get("핏감") || "",
    },
    origin: r.get("원산지") || "",
    notice: {
      manufacturer: r.get("제조자") || "",
      madeAt: r.get("제조연월") || "",
      colorSize: "상세페이지 참조",
      quality: "전자상거래 법에 규정되어 있는 소비자 청약철회 가능 범위를 준수합니다.",
      as: "N°1 고객센터\n상품 문의는 화면 상단의 문의 아이콘을 이용해 주세요.",
    },
    colorOptions: (r.get("색상옵션") || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    sizeOptions: (r.get("사이즈옵션") || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    optionStock: parseStock(r.get("옵션별재고") || ""),
    whyThisProduct: UNKNOWN(r.get("선정이유")),
    materialSource: UNKNOWN(r.get("소재출처")),
    careSource: UNKNOWN(r.get("세탁출처")),
    measurementSource: UNKNOWN(r.get("치수출처")),
    stockSource: UNKNOWN(r.get("재고출처")),
    whySource: UNKNOWN(r.get("선정이유출처")),
  }));
}

function parseStock(raw: string): Record<string, number> {
  const optionStock: Record<string, number> = {};
  for (const pair of raw.split("|")) {
    const [k, v] = pair.split(":");
    if (k && v !== undefined && v !== "") optionStock[k.trim()] = Number(v) || 0;
  }
  return optionStock;
}

/** 이름/품번으로 카탈로그 상품 찾기 (CS 문맥 매칭 — 점수 기반, 과신하지 않게 최소 길이 요건) */
export function matchCatalogProduct(
  products: CatalogProduct[],
  query: string,
): CatalogProduct | null {
  const q = (query || "").trim();
  if (!q) return null;
  // 품번 정확 매칭 우선
  const byId = products.find((p) => p.id && q.toUpperCase().includes(p.id.toUpperCase()));
  if (byId) return byId;
  let best: { p: CatalogProduct; score: number } | null = null;
  for (const p of products) {
    // 상품명 토큰 매칭 (2자 이상 토큰만 — 오탐 방지)
    let score = 0;
    for (const token of p.name.split(/\s+/)) {
      if (token.length >= 2 && q.includes(token)) score += token.length;
    }
    if (p.id && q.includes(p.id)) score += 10;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best ? best.p : null;
}
