/**
 * N°1 — 시트 실시간 연동 API (Route Handler)
 * GET /api/products → 구글 시트 Products(한국어 헤더)에서 상품을, Pairs 시트에서
 * 사전 계산된 TOP×BOTTOM 페어 mapping을 함께 반환한다.
 * 읽기 로직은 lib/catalog.ts·lib/pairs.ts 공용 계층(AI CS와 동일 데이터 소스)을 사용한다.
 * pair_score_internal 같은 내부 랭킹 필드는 노출하지 않는다 (§47).
 *
 * [SESSION L · TASK 29] 시트 실패 시 내부 예외 원문을 고객에게 보내지 않는다 —
 * 고정 문구 + 502 (원문은 서버 로그에만).
 */
import { NextResponse } from "next/server";
import { fetchCatalog } from "@/lib/catalog";
import { fetchCatalogPairs } from "@/lib/pairs";
import { GENERIC_UPSTREAM_MESSAGE, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [products, pairs] = await Promise.all([fetchCatalog(), fetchCatalogPairs()]);
    return NextResponse.json({ ok: true, products, pairs, updatedAt: new Date().toISOString() });
  } catch (e: unknown) {
    logInternal("api/products", e);
    return NextResponse.json({ ok: false, error: GENERIC_UPSTREAM_MESSAGE, products: [], pairs: [] }, { status: 502 });
  }
}
