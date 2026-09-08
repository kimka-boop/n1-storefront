/**
 * N°1 Top × Bottom 페어링 — Pairs 시트 읽기 공용 계층
 *
 * 정책: N1_PAIRING_POLICY_V1 (HERMES 소유, 2026-09-09 제정)
 * - 페어는 catalog curation 단계에서 사전 계산된 mapping만 읽는다 (§37 — LLM per pageview 금지)
 * - pair_score_internal은 내부 머천다이징 랭킹 전용 — 프론트엔드로 노출하지 않는다 (§40·§47)
 *   대신 정렬은 서버에서 스코어 순으로 마친 뒤 스코어 필드를 떼고 반환한다.
 * - BELOW_THRESHOLD 페어는 primary 뷰에서 제외 (§46 — 나쁜 조합 강제 금지)
 */
import { getDoc } from "@/lib/sheets";

export const PAIRS_SHEET = "Pairs";

export interface CatalogPair {
  pairId: string;
  collectionScope: string; // MALE | FEMALE | GENDERLESS
  scopeLabel: string;
  topProductId: string;
  bottomProductId: string;
  trendClusters: string[];
  pairReasonShort: string;
}

interface PairRowInternal extends CatalogPair {
  tier: string;
  score: number;
}

/** Pairs 시트 → primary 페어 목록 (스코어 순 정렬, 내부 스코어 제거) */
export async function fetchCatalogPairs(): Promise<CatalogPair[]> {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[PAIRS_SHEET];
  if (!sheet) return [];
  const rows = await sheet.getRows();
  const internal: PairRowInternal[] = [];
  for (const r of rows) {
    const tier = String(r.get("tier") || "");
    if (tier === "BELOW_THRESHOLD") continue; // §46: 미달 페어는 primary 금지
    const scope = String(r.get("collection_scope") || "");
    internal.push({
      pairId: String(r.get("pair_id") || ""),
      collectionScope: scope,
      scopeLabel: scope === "MALE" ? "남성" : scope === "FEMALE" ? "여성" : "젠더리스",
      topProductId: String(r.get("top_product_id") || ""),
      bottomProductId: String(r.get("bottom_product_id") || ""),
      trendClusters: String(r.get("trend_clusters") || "").split(",").filter(Boolean),
      pairReasonShort: String(r.get("pair_reason_short") || ""),
      tier,
      score: Number(r.get("pair_score_internal") || 0),
    });
  }
  // BEST_MATCH 먼저, 스코어 내림차순 — 결정적 순서
  internal.sort((a, b) => {
    const t = (a.tier === "BEST_MATCH" ? 0 : 1) - (b.tier === "BEST_MATCH" ? 0 : 1);
    return t !== 0 ? t : b.score - a.score;
  });
  return internal.map(({ pairId, collectionScope, scopeLabel, topProductId, bottomProductId, trendClusters, pairReasonShort }) => ({
    pairId, collectionScope, scopeLabel, topProductId, bottomProductId, trendClusters, pairReasonShort,
  }));
}
