/**
 * [OPS INTERNAL] 주문 라이프사이클 운영 조작 — TEST_ONLY 게이트 (미션 §67·§71–§73)
 *
 * 게이트 2중:
 *  1. N1_SHIPPING_WATCHER_ENABLED=true (운영 런타임이 켠 인스턴스만)
 *  2. 대상 주문번호가 반드시 TEST- 로 시작 (운영 주문 오염 구조적 차단)
 *
 * 액션:
 *  - watcher-tick            §22 워처 1사이클 즉시 실행
 *  - advance-test-shipping   §71 테스트 공급사 상태 1단계 진행 (4사이클 시뮬레이션)
 *  - return-transition       §41 라이프사이클 전이 (E2E/운영 승인 경로가 호출)
 *  - cancel-confirm          §53 취소 확정 (요청 상태 검증 후)
 *  - return-approval-request §42 오너 승인 카드 발송
 */
import { NextResponse } from "next/server";
import { getDoc } from "@/lib/sheets";
import { runShippingWatcherCycle, ensureShippingWatcherRuntime } from "@/lib/shippingWatcher";
import { applyReturnTransition, type ReturnLifecycleState } from "@/lib/returnLifecycle";
import { confirmCancellation } from "@/lib/cancellation";
import { sendReturnApprovalRequest, ensureOpsApprovalRuntime } from "@/lib/telegramOps";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

// 이 라우트가 처음 로드될 때 env 게이트(N1_SHIPPING_WATCHER_ENABLED=true)에 따라
// 6시간 워처 인터벌 + 오너 승인 콜백 폴링이 구동된다 (게이트 꺼짐 = 즉시 no-op).
ensureShippingWatcherRuntime(() => getDoc());
ensureOpsApprovalRuntime(() => getDoc());

function gate(): string | null {
  if ((process.env.N1_SHIPPING_WATCHER_ENABLED || "").trim().toLowerCase() !== "true") {
    return "ops runtime disabled";
  }
  return null;
}

/** TEST 격리 — 운영 주문은 이 경로로 절대 바꾸지 않는다 */
function assertTestOrder(orderId: string): string | null {
  if (!orderId.startsWith("TEST-")) return "TEST- 주문만 허용됩니다";
  return null;
}

export async function POST(req: Request) {
  const g = gate();
  if (g) return NextResponse.json({ ok: false, error: g }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const openDoc = () => getDoc();

    if (action === "watcher-tick") {
      const result = await runShippingWatcherCycle(openDoc, {
        advanceOrderId: body?.advance_order_id ? String(body.advance_order_id) : undefined,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "advance-test-shipping") {
      const orderId = String(body?.order_id || "");
      const bad = assertTestOrder(orderId);
      if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
      // advance는 watcher-tick에 위임한다 (상태 폴링과 동일 사이클에서 정규화)
      const result = await runShippingWatcherCycle(openDoc, { advanceOrderId: orderId });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "return-transition") {
      const orderId = String(body?.order_id || "");
      const bad = assertTestOrder(orderId);
      if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
      const result = await applyReturnTransition(openDoc, String(body?.request_id || ""), String(body?.to || "") as ReturnLifecycleState, {
        actor: String(body?.actor || "ops_e2e"),
        memo: body?.memo ? String(body.memo) : undefined,
        refundAmount: typeof body?.refund_amount === "number" ? body.refund_amount : undefined,
      });
      return NextResponse.json({ ...result }, { status: result.ok ? 200 : 409 });
    }

    if (action === "cancel-confirm") {
      const orderId = String(body?.order_id || "");
      const bad = assertTestOrder(orderId);
      if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
      const result = await confirmCancellation(openDoc, orderId, { actor: "ops_e2e" });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    if (action === "return-approval-request") {
      const orderId = String(body?.order_id || "");
      const bad = assertTestOrder(orderId);
      if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
      const sent = await sendReturnApprovalRequest({
        requestId: String(body?.request_id || ""),
        orderId,
        customerType: String(body?.customer_type || ""),
        productDesc: String(body?.product_desc || ""),
        amount: Number(body?.amount || 0),
        shipStatus: String(body?.ship_status || ""),
        deliveredAt: String(body?.delivered_at || ""),
        requestedAt: String(body?.requested_at || new Date().toISOString()),
        customerReason: String(body?.customer_reason || ""),
        hermesVerdict: String(body?.hermes_verdict || ""),
      });
      return NextResponse.json({ ok: sent, delivered: sent ? "telegram" : "bot_not_configured_or_failed" });
    }

    return NextResponse.json({ ok: false, error: "알 수 없는 action" }, { status: 400 });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/ops", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
