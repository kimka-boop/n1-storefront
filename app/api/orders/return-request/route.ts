/**
 * [반품·교환 요청] Session I — Tasks 16·17
 *
 * POST /api/orders/return-request
 *   회원: { order_id, token, type, reason_code, items[], note? }
 *   게스트: { order_id, phone, type, reason_code, items[], note? }
 *   → 소유 검증(회원 이메일 / 게스트 연락처 완전일치 — C 계약) → 상태머신 판정(lib/orderState) →
 *     Return_Requests 시트 1행 접수 기록 + Ops(CS 봇3) 알림 best-effort.
 *
 * GET /api/orders/return-request?order_id=&token=|&phone=
 *   → 소유 검증 후 그 주문의 접수된 요청 목록 + 현재 주문 상태(canonical 라벨).
 *
 * 경계 (세션 지시 §5):
 * - Orders 시트 write는 수행하지 않는다(HERMES authority). 이 라우트의 쓰기는
 *   app 소유 Return_Requests 시트뿐이다.
 * - 자동 refund 승인 금지 — 접수(reception)만. PAID/REFUND 전이·환불 확정은 Ops가
 *   Orders 시트에 기록하며, 그 결과는 readOrderStatus로 읽혀 돌아온다.
 * - 소유 불일치·미존재는 구분 없는 generic 404 (PII 0 — /api/orders/lookup 계약 동일).
 */
import { NextResponse } from "next/server";
import { getDoc, findOrderById } from "@/lib/sheets";
import { appendReturnRequestRow, findReturnRequestsByOrder } from "@/lib/returnRequestsSheet";
import {
  submitReturnRequest,
  verifyRequestOwnership,
  projectRequestRow,
  currentOrderStatusLabel,
} from "@/lib/returnRequest";
import { sendTelegramMessage } from "@/lib/telegram";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.text(); // UTF-8 명시 파싱 — orders route와 동일 (mojibake 방지)
    const body = JSON.parse(raw);
    const doc = await getDoc();

    const result = await submitReturnRequest(
      {
        findOrder: async (orderId) => {
          const record = await findOrderById(doc, orderId);
          if (!record) return null;
          return {
            itemsJson: record.itemsJson,
            paymentStatus: record.paymentStatus,
            shipStatus: record.shipStatus,
            csMemo: record.csMemo,
            customerId: record.customerId,
            customerPhone: record.customerPhone,
            orderEmail: record.raw["고객이메일"] || "",
          };
        },
        // auth core 세션 저장소 읽기 전용 (수정 없음 — Session C GET /api/orders와 동일 경계)
        findSession: (token) => global.__userStore?.sessions?.[token],
        appendRequest: (row) => appendReturnRequestRow(doc, row),
        // Ops 알림 — CS 상담 전담 봇3 (Session D 주입 credential). 미설정이면 미발송으로 건너뛴다.
        notifyOps: (message) =>
          sendTelegramMessage(
            process.env.N1_CS_BOT_TOKEN || "",
            process.env.N1_CS_CHAT_ID || "",
            message,
          ),
      },
      {
        order_id: body?.order_id,
        token: body?.token,
        phone: body?.phone,
        type: body?.type,
        reason_code: body?.reason_code,
        note: body?.note,
        items: body?.items,
      },
    );

    // strict:false 프로젝트 — truthiness 대신 리터럴 비교로 판별 좁혀짐
    if (result.ok === false) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      request_id: result.request_id,
      message: result.message,
      request: result.request,
    });
  } catch (e: unknown) {
    // [SESSION L · TASK 29] 계약 오류(400/404/409)는 그대로, 나머지는 고정 문구 + 502
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders/return-request", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const orderId = (sp.get("order_id") || "").trim();
    const token = (sp.get("token") || "").trim();
    const phone = (sp.get("phone") || "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "주문번호가 필요합니다" }, { status: 400 });
    }

    const doc = await getDoc();
    const record = await findOrderById(doc, orderId);
    const findSession = (t: string) => global.__userStore?.sessions?.[t];
    const channel =
      record
        ? verifyRequestOwnership(
            { token, phone },
            { orderEmail: record.raw["고객이메일"] || "", orderPhone: record.customerPhone },
            findSession,
          )
        : null;
    // 미존재 / 소유 불일치 / 인증 없음 → 구분 없는 동일 응답 (존재 유출 없음)
    if (!record || !channel) {
      return NextResponse.json(
        { ok: false, error: "주문번호와 회원 계정(또는 연락처)이 일치하는 주문을 찾을 수 없습니다" },
        { status: 404 },
      );
    }

    const rows = await findReturnRequestsByOrder(doc, orderId);
    return NextResponse.json({
      ok: true,
      order_status: currentOrderStatusLabel({
        paymentStatus: record.paymentStatus,
        shipStatus: record.shipStatus,
        csMemo: record.csMemo,
      }),
      requests: rows.map(projectRequestRow),
    });
  } catch (e: unknown) {
    // [SESSION L · TASK 29] 계약 오류(400/404/409)는 그대로, 나머지는 고정 문구 + 502
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders/return-request", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
