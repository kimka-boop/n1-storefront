/**
 * [CS 위젯 API] 대화 복원 / 상담원 답변 폴링
 * GET /api/cs?sid=... → { ok, status, messages, agent_messages }
 *   - messages: 전체 전사본 (새로고침 후 대화 복원용 — role 구분 포함)
 *   - agent_messages: 아직 고객에게 전달되지 않은 상담원 답변만 (폴링 소비)
 *
 * 고객이 상담원 답변을 폴링으로 소비하면 delivered 마킹. status는 유지한다
 * (기존 구현은 소비 시 closed로 바꿔 상담 중 추가 답변을 놓치는 결함이 있었다).
 */
import { NextResponse } from "next/server";
import { getStore } from "@/lib/csStore";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
    messages: sess.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts })),
  });
}
