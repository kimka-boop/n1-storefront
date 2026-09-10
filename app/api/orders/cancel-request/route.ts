/**
 * [취소 요청] Master Acceptance §39–§40
 *
 * POST /api/orders/cancel-request
 *   회원:  { order_id, token, reason? }   — 서버 세션으로 소유 검증
 *   게스트: { order_id, phone, reason? }  — 주문 연락처 전체 일치 (열거 방지: 균일 404)
 *
 * 배송 단계 라우팅(§39):
 *   배송준비 → CANCELLATION (취소 요청 접수 — 확정은 운영 검증 후)
 *   배송중   → RETURN_INTERCEPTION (취소 아님 — 반품·중단 검토)
 *   배송완료 → RETURN_REFUND (반품·환불 경계 + 반품 가능 기간 안내 §27)
 *
 * 이 라우트는 요청만 기록한다 — 확정(§53)은 /api/ops cancel-confirm(오너 검증 후).
 */
import { NextResponse } from "next/server";
import { getDoc } from "@/lib/sheets";
import { requestCancellation } from "@/lib/cancellation";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.text(); // UTF-8 명시 파싱 — orders route와 동일
    const body = JSON.parse(raw);
    const orderId = String(body?.order_id || "").trim();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const phone = String(body?.phone || "").trim();
    const reason = String(body?.reason || "").trim();
    if (!orderId || (!token && !phone)) {
      return NextResponse.json(
        { ok: false, error: "주문번호와 회원 토큰(또는 연락처)이 필요합니다" },
        { status: 400 },
      );
    }

    // 서버 세션에서 이메일 해석 — 클라이언트가 보낸 이메일 문자열은 신뢰하지 않는다
    const sessionEmail = token ? global.__userStore?.sessions?.[token] : undefined;
    if (token && !sessionEmail) {
      // 토큰 불능 — 게스트 경로도 아니므로 균일 404 (세션 존재 유출 없음)
      return NextResponse.json(
        { ok: false, error: "주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    const result = await requestCancellation(() => getDoc(), {
      orderId,
      ownership: { memberEmail: sessionEmail, guestPhone: phone || undefined },
      reason,
    });

    if (result.ok === false) {
      return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      process: result.process,
      order_status: result.order_status,
      message: result.message,
      window_label: result.windowLabel ?? null,
    });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders/cancel-request", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
