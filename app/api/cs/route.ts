/**
 * [CS 위젯 API] 대화 복원 / 상담원 답변 폴링
 * GET /api/cs?sid=... → { ok, status, messages, agent_messages }
 *   - messages: 전체 전사본 (새로고침 후 대화 복원용 — role·source·id 포함)
 *   - agent_messages: 아직 고객에게 전달되지 않은 상담원 답변만 (폴링 소비)
 *
 * 고객이 상담원 답변을 폴링으로 소비하면 delivered 마킹. status는 유지한다
 * (기존 구현은 소비 시 closed로 바꿔 상담 중 추가 답변을 놓치는 결함이 있었다).
 *
 * source는 메시지 provenance다 — CUSTOMER 메시지는 반드시 WEB_CUSTOMER_INPUT이어야
 * 하며(사고 #B), 이 엔드포인트는 출처 감사(미션 §35 Test F)에도 사용된다.
 */
import { NextResponse } from "next/server";
import { getStore } from "@/lib/csStore";
import { ensureTelegramInbound } from "@/lib/telegramInbound";
import { GENERIC_UPSTREAM_MESSAGE, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // 복원/폴링 접근 시에도 운영자 답장 소비자가 살아 있는지 보장한다 (사고 #A)
    await ensureTelegramInbound();
    const sid = new URL(req.url).searchParams.get("sid");
    if (!sid) return NextResponse.json({ ok: false, error: "sid 누락" }, { status: 400 });
    const store = getStore();
    const sess = store.sessions[sid];
    if (!sess) return NextResponse.json({ ok: false, error: "세션 없음" }, { status: 404 });

    const undelivered = sess.messages.filter((m) => m.role === "agent" && !m.delivered);
    if (undelivered.length) {
      for (const m of sess.messages) {
        if (m.role === "agent") m.delivered = true;
      }
    }

    return NextResponse.json({
      ok: true,
      sid,
      status: sess.status,
      agent_messages: undelivered.map((m) => m.text),
      messages: sess.messages.map((m) => ({
        id: m.id,
        role: m.role,
        source: m.source,
        text: m.text,
        ts: m.ts,
      })),
    });
  } catch (e: unknown) {
    // [SESSION L] 핸들러 무방비 크래시(=계약 밖 500) 차단 — ok:false 계약 유지
    logInternal("api/cs", e);
    return NextResponse.json({ ok: false, error: GENERIC_UPSTREAM_MESSAGE }, { status: 502 });
  }
}
