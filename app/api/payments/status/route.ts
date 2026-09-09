/**
 * [결제 상태 조회] GET /api/payments/status?order_id=…&phone=…
 *
 * 체크아웃 완료 화면·재시도 흐름이 주문의 결제 상태를 물어보는 창구.
 * - 소유 검증: 주문번호 + 연락처 완전 일치(게스트) 또는 회원 토큰. 주문번호만으로는 아무것도 안 내려간다.
 * - 무통장: Orders.결제상태 문자열이 단일 진실 → lib/paymentState 매핑으로 읽는다 (운영자 수동 갱신 유지).
 * - PG: Payments 시트의 최신 시도 상태.
 * 응답은 결제 상태 투영만 — PII·시크릿 0.
 */
import { NextResponse } from "next/server";
import { getDoc, findOrderById } from "@/lib/sheets";
import { verifyGuestOwnership, publicOrderProbeRejected } from "@/lib/orderView";
import { getPaymentStatusView, PaymentFlowDeps } from "@/lib/paymentFlow";
import { findPaymentsByOrderId } from "@/lib/paymentRecords";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderId = (url.searchParams.get("order_id") || "").trim();
    const phone = (url.searchParams.get("phone") || "").trim();
    const token = (url.searchParams.get("token") || "").trim();
    if (!orderId) {
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }

    const doc = await getDoc();
    const record = await findOrderById(doc, orderId);

    // 회원 토큰 경로 — 세션 이메일과 주문 이메일 일치 시 허용
    let owned = false;
    if (token) {
      const email = global.__userStore?.sessions?.[token];
      const orderEmail = String(record?.raw?.["고객이메일"] || "").trim().toLowerCase();
      owned = Boolean(email && orderEmail && email === orderEmail);
    }
    if (!owned && !verifyGuestOwnership(record, phone)) {
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }

    const { provider } = resolvePaymentProvider();
    const deps = {
      provider,
      findPaymentsByOrder: (id: string) => findPaymentsByOrderId(doc, id),
    } as unknown as PaymentFlowDeps; // status 뷰는 loadOrder/provider 호출 외 deps를 쓰지 않는다

    const view = await getPaymentStatusView(deps, record!);
    if (view.ok === false) {
      return NextResponse.json({ ok: false, error: view.message }, { status: view.http });
    }
    return NextResponse.json({ ok: true, order_id: orderId, payment: view.payment });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/payments/status", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
