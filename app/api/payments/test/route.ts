/**
 * [테스트 결제 정산 발화 — TEST_ONLY 격리 경로] POST /api/payments/test
 * { provider_payment_id } → 합성 PG 정산(settleTestPayment) → webhook 파이프라인 재사용 검증
 *
 * 이 라우트는 N1_PG_TEST_ONLY=true 인 프로세스에서만 존재한다. 그 env가 없으면 어떤 입력도
 * 받지 않고 404로 답한다 — 프로덕션에서 경로 자체가 비활성. 정산이 명시 호출 없이
 * 일어나는 경로는 없다 (위조 없는 E2E).
 */
import { NextResponse } from "next/server";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { settleTestPayment } from "@/lib/paymentProvider";
import { settlePaymentWebhook } from "@/lib/paymentFlow";
import { buildPaymentFlowDeps } from "@/lib/paymentFlowWiring";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { provider } = resolvePaymentProvider();
  if (provider.name !== "test_only") {
    // 테스트 PG 비활성 — 존재조차 드러내지 않는다
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const providerPaymentId = String(body?.provider_payment_id || "").trim();
  if (!providerPaymentId) {
    return NextResponse.json({ ok: false, error: "provider_payment_id 누락" }, { status: 400 });
  }
  if (!settleTestPayment(providerPaymentId)) {
    return NextResponse.json(
      { ok: false, code: "TEST_SETTLE_NOT_ALLOWED", error: "정산 가능한 대기 상태의 테스트 결제가 아닙니다" },
      { status: 409 },
    );
  }
  // 합성 PG가 webhook을 쏜 것처럼 동일 파이프라인으로 검증·확정한다 (테스트가 실제 경로를 검증)
  const deps = await buildPaymentFlowDeps(provider);
  const raw = JSON.stringify({ provider_payment_id: providerPaymentId });
  const result = await settlePaymentWebhook(deps, {
    headers: { "content-type": "application/json" },
    rawBody: raw,
    parsed: { provider_payment_id: providerPaymentId },
  });
  return NextResponse.json(result.payload, { status: result.http });
}
