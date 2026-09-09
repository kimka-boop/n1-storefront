/**
 * [PG 결제 webhook 수신] POST /api/payments/webhook
 *
 * 미션 §19~§22: PG가 서버로 보내는 결과 통지 → **서명 검증** → 서버가 PG에 직접 조회해
 * 재검증(payload 금액·상태 미신뢰) → 멱등 확정 → 주문 확정(PAID) + 지연 재고 차감 +
 * HERMES 이벤트 + 봇2(N1 결제발주센터) 알림.
 *
 * pre-PG 상태: resolvePaymentProvider가 no_live_pg — webhook은 503 PAYMENT_PROVIDER_NOT_CONFIGURED.
 * 시그니처 불일치 webhook은 401로 폐기하고 본문을 해석하지 않는다.
 */
import { NextResponse } from "next/server";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { settlePaymentWebhook } from "@/lib/paymentFlow";
import { buildPaymentFlowDeps } from "@/lib/paymentFlowWiring";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { provider, livePgAvailable } = resolvePaymentProvider();
    if (!livePgAvailable) {
      return NextResponse.json(
        { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED", error: "결제 시스템 준비 중입니다." },
        { status: 503 },
      );
    }
    const raw = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });

    // 본문 해석은 어댑터 중립적으로 최소 참조(provider_payment_id)만 꺼낸다 —
    // 금액·상태는 어댑터 verifyPayment(서버→PG 조회)가 단일 진실로 돌려준다.
    let parsed: { provider_payment_id?: string; order_id?: string } = {};
    try {
      const json = JSON.parse(raw);
      parsed = {
        provider_payment_id: typeof json?.provider_payment_id === "string" ? json.provider_payment_id
          : typeof json?.paymentKey === "string" ? json.paymentKey
          : typeof json?.transactionId === "string" ? json.transactionId
          : undefined,
        order_id: typeof json?.orderId === "string" ? json.orderId : typeof json?.order_id === "string" ? json.order_id : undefined,
      };
    } catch {
      return NextResponse.json({ ok: false, code: "WEBHOOK_BODY_INVALID" }, { status: 400 });
    }

    const deps = await buildPaymentFlowDeps(provider);
    const result = await settlePaymentWebhook(deps, { headers, rawBody: raw, parsed });
    return NextResponse.json(result.payload, { status: result.http });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/payments/webhook", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
