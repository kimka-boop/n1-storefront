/**
 * N°1 — 시트 실시간 연동 API (Route Handler)
 * GET /api/products → 구글 시트 Products(한국어 헤더)에서 데이터를 읽어 JSON으로 반환
 * 읽기 로직은 lib/catalog.ts 공용 계층(AI CS와 동일 데이터 소스)을 사용한다.
 */
import { NextResponse } from "next/server";
import { fetchCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await fetchCatalog();
    return NextResponse.json({ ok: true, products, updatedAt: new Date().toISOString() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, products: [] }, { status: 500 });
  }
}
