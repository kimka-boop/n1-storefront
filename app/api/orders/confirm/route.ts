/**
 * [입금 확인 요청] 무통장입금 V1 플로우
 * POST /api/orders/confirm { order_id, name } → { ok }
 *
 * - Orders.CS메모에 요청 기록 (기존 값 보존)
 * - 봇2(결제·발주) 채널로 확인 요청 알림
 * - 주문 상태 자체는 운영자(디렉터)가 입금 대장 확인 후 갱신한다 —
 *   클라이언트 요청만으로 결제상태를 '완료'로 바꾸지 않는다 (미션 §11·§49)
 */
import { NextResponse } from "next/server";
import { getDoc, getOrdersSheet } from "@/lib/sheets";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    const name = String(body?.name || "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "order_id 누락" }, { status: 400 });
    }
    const doc = await getDoc();
    const sheet = await getOrdersSheet(doc);
    if (!sheet) {
      return NextResponse.json({ ok: false, error: "Orders 시트 없음" }, { status: 500 });
    }
    const rows = await sheet.getRows();
    const row = rows.find((r) => String(r.get("주문번호")) === orderId);
    if (!row) {
      return NextResponse.json({ ok: false, error: "주문 없음" }, { status: 404 });
    }

    // CS메모 기록 (기존 값 보존)
    const prev = String(row.get("CS메모") || "").trim();
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

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
