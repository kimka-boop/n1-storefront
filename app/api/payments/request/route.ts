/**
 * [결제 요청 생성] POST /api/payments/request  { order_id, phone }
 *
 * 미션 §18 계약: 서버가 ①주문 draft 로딩 ②상태 확인(PAYMENT_PENDING) ③금액 재계산·대조
 * ④결제 레코드 생성 ⑤PG 어댑터 호출 ⑥안전 응답 — 전부 lib/paymentFlow가 수행하고
 * 이 라우트는 배선과 소유 검증만 담는다.
 *
 * 소유 검증: 주문번호 + 연락처 완전 일치 (게스트 조회 계약과 동일 — 주문번호만으로는
 * 결제 요청을 만들지 못한다). 무통장 주문은 400 PAYMENT_REQUEST_NOT_APPLICABLE.
 * PG 미연결 환경에서는 pg_card 주문 자체가 생성되지 않으므로 이 라우트는 503을 돌려준다.
 */
import { NextResponse } from "next/server";
import { getDoc, findOrderById } from "@/lib/sheets";
import { verifyGuestOwnership, publicOrderProbeRejected } from "@/lib/orderView";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { createPaymentRequestForOrder } from "@/lib/paymentFlow";
import { buildPaymentFlowDeps } from "@/lib/paymentFlowWiring";
import { ensureStore } from "@/lib/authSheets";
import { findOwnedMethod } from "@/lib/savedPayments";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    const phone = String(body?.phone || "").trim();
    if (!orderId || !phone) {
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }

    const doc = await getDoc();
    const record = await findOrderById(doc, orderId);
    if (!record || !verifyGuestOwnership(record, phone)) {
      // 미존재/불일치 구분 없음 — 존재 유출 없는 generic 응답
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }

    const { provider } = resolvePaymentProvider();
    const deps = await buildPaymentFlowDeps(provider);

    // 세이브드 결제 수단 경로 — 세션 이메일 소유 일치가 확인된 수단만 어댑터로 넘긴다.
    // method_id 단독(소유 증명 없음)으로는 절대 결제되지 않는다 (IDOR 방지 계약).
    let savedMethod: { methodId: string; providerBillingKey: string } | undefined;
    const methodId = String(body?.method_id || "").trim();
    if (methodId) {
      const store = await ensureStore();
      const account = store.accountOf(String(body?.token || ""));
      if (!account) {
        return NextResponse.json({ ok: false, code: "LOGIN_REQUIRED", error: "저장한 결제 수단으로 결제하려면 로그인이 필요해요" }, { status: 401 });
      }
      const doc2 = await getDoc();
      const owned = await findOwnedMethod(doc2, account.email, methodId);
      if (!owned) {
        return NextResponse.json({ ok: false, code: "METHOD_NOT_FOUND", error: "결제 수단을 찾을 수 없어요" }, { status: 404 });
      }
      savedMethod = { methodId: owned.methodId, providerBillingKey: owned.providerBillingKey };
    }

    const result = await createPaymentRequestForOrder(deps, orderId, savedMethod ? { savedMethod } : undefined);
    return NextResponse.json(result.payload, { status: result.http });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/payments/request", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
