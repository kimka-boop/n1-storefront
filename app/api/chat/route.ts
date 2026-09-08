/**
 * [CS 챗봇 응답 API]
 * POST /api/chat  { sid?, message, customer? } → { ok, sid, reply, status, escalated }
 *
 * 대화 상태 머신 + 검증 데이터 응답 + Human escalation은 lib/csEngine.ts,
 * 세션 스토어는 lib/csStore.ts (V1 인메모리)에서 처리한다.
 * 고객 UI에는 내부 이름(HERMES/n1-cs)을 노출하지 않는다 (미션 §42).
 */
import { NextResponse } from "next/server";
import { handleCustomerMessage } from "@/lib/csEngine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // 클라이언트가 encodeURIComponent로 전송 → 복원 (mojibake 방지, 기존 계약 유지)
    let message: string = body.message || "";
    try { message = decodeURIComponent(message); } catch {}
    if (!message.trim()) {
      return NextResponse.json({ ok: false, error: "메시지 누락" }, { status: 400 });
    }

    const customer = body.customer || {};
    const result = await handleCustomerMessage(body.sid, message, {
      email: typeof customer.email === "string" ? customer.email : undefined,
      member: Boolean(customer.member),
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
