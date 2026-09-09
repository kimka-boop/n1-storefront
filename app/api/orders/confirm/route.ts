/**
 * [입금 확인 요청] 무통장입금 V1 플로우
 * POST /api/orders/confirm { order_id, name } → { ok, duplicate? }
 *
 * - Orders.CS메모에 요청 기록 (기존 값 보존)
 * - 봇2(결제·발주) 채널로 확인 요청 알림
 * - 주문 상태 자체는 운영자(디렉터)가 입금 대장 확인 후 갱신한다 —
 *   클라이언트 요청만으로 결제상태를 '완료'로 바꾸지 않는다 (미션 §11·§49)
 *
 * [Session C — 멱등성 §7/§9]
 * - 더블 클릭/새로고침/콜백 재시도로 같은 주문의 확인 요청이 반복 도착해도
 *   CS메모·알림은 주문당 1회만 기록된다 (중복 재도착은 duplicate: true 로 정직 응답).
 * - 주문이 이미 PAID 이상이면(운영자가 결제완료 처리) 요청을 새로 기록하지 않는다.
 */
import { NextResponse } from "next/server";
import { getDoc, getOrdersSheet } from "@/lib/sheets";
import { withIdempotency } from "@/lib/idempotency";
import { toCanonicalStatus } from "@/lib/orderState";
import { confirmMemoAlreadyRequested } from "@/lib/orderView";
import { sendTelegramMessage } from "@/lib/telegram";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    const name = String(body?.name || "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "order_id 누락" }, { status: 400 });
    }

    // 주문당 1회 수렴 — 재도착/동시 도착 모두 여기로 합쳐진다
    const { value } = await withIdempotency("orders.confirm", orderId, async () => {
      const doc = await getDoc();
      const sheet = await getOrdersSheet(doc);
      if (!sheet) {
        // [SESSION L] 내부 저장소 구조 문제 — 고정 문구로 던지고 원문은 로그로만
        console.error("[orders/confirm] Orders 시트 탭을 찾지 못했습니다");
        throw Object.assign(new Error("확인 요청 처리 중 문제가 발생했습니다"), { status: 500 });
      }
      const rows = await sheet.getRows();
      const row = rows.find((r) => String(r.get("주문번호")) === orderId);
      if (!row) {
        throw Object.assign(new Error("주문 없음"), { status: 404 });
      }

      // 운영자가 이미 결제완료 이상으로 처리했다면 새 확인 요청을 남기지 않는다
      const canonical = toCanonicalStatus({
        paymentStatus: String(row.get("결제상태") || ""),
        shipStatus: String(row.get("배송상태") || ""),
      });
      if (canonical !== "PAYMENT_PENDING") {
        return { alreadyResolved: canonical };
      }

      // CS메모 기록 (기존 값 보존) — 이미 같은 주문의 요청이 있으면 재기록하지 않는다
      const prev = String(row.get("CS메모") || "").trim();
      if (confirmMemoAlreadyRequested(prev)) {
        return { alreadyRequested: true };
      }
      const entry = `[${new Date().toISOString().slice(0, 16)}] 입금확인요청 ${name || "-"}`;
      row.set("CS메모", prev ? `${prev}\n${entry}` : entry);
      await row.save();

      // 봇2 알림
      const r = await sendTelegramMessage(
        process.env.N1_PAYMENT_BOT_TOKEN || "",
        process.env.N1_PAYMENT_CHAT_ID || "",
        `💰 입금 확인 요청\n주문번호: ${orderId}\n입금자: ${name || String(row.get("입금자명") || "-")}\n금액: ${String(row.get("총결제금액") || "-")}원\n→ 입금 대장 확인 후 결제상태를 갱신해주세요`,
      );
      if (!r.ok) console.warn("[orders/confirm] 봇2 알림 미발송");
      return { recorded: true };
    });

    if ("alreadyResolved" in value) {
      // 결제가 이미 처리된 주문 — 상태를 정직하게 알린다 (fake success 없음)
      return NextResponse.json({ ok: true, duplicate: true, status: value.alreadyResolved });
    }
    return NextResponse.json({ ok: true, ...(value.alreadyRequested ? { duplicate: true } : {}) });
  } catch (e: unknown) {
    // [SESSION L · TASK 29] 계약 오류(400/404)는 그대로, 나머지는 고정 문구 + 502
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/orders/confirm", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
