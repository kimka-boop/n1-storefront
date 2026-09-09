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
import { ensureTelegramInbound } from "@/lib/telegramInbound";
import { GENERIC_UPSTREAM_MESSAGE, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // 상담은 언제나 고객 웹 활동에서 시작된다 — 이 시점에 운영자 답장 소비자를 띄운다 (사고 #A)
    await ensureTelegramInbound();
    const body = await req.json();
    // 클라이언트가 encodeURIComponent로 전송 → 복원 (mojibake 방지, 기존 계약 유지)
    let message: string = body.message || "";
    try { message = decodeURIComponent(message); } catch {}
    if (!message.trim()) {
      return NextResponse.json({ ok: false, error: "메시지 누락" }, { status: 400 });
    }

    const customer = body.customer || {};
    const sessionKey = typeof body.session_key === "string" ? body.session_key : null;
    const result = await handleCustomerMessage(body.sid, message, {
      email: typeof customer.email === "string" ? customer.email : undefined,
      member: Boolean(customer.member),
    }, sessionKey);
    return NextResponse.json(result);
  } catch (e: unknown) {
    // [SESSION L · TASK 29] 내부 예외 원문(파서·시트 오류)을 고객에게 보내지 않는다
    logInternal("api/chat", e);
    return NextResponse.json({ ok: false, error: GENERIC_UPSTREAM_MESSAGE }, { status: 502 });
  }
}
