/**
 * [Telegram CS 봇 수동 폴링 폴백]
 * POST /api/telegram/poll { offset? } → getUpdates 1회 호출 후 릴레이 처리
 *
 * 웹훅을 달지 않은 로컬/테스트 환경용. 운영에서는 webhook 사용 권장
 * (getUpdates와 webhook은 동시에 쓸 수 없다 — Telegram 제약).
 * offset 저장은 호출자가 한다(응답의 next_offset을 그대로 재전달).
 */
import { NextResponse } from "next/server";
import { getTelegramUpdates } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/csRelay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = process.env.N1_CS_BOT_TOKEN || "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "N1_CS_BOT_TOKEN 미설정" }, { status: 400 });
  }
  let offset = 0;
  try {
    const body = await req.json();
    offset = Number(body?.offset) || 0;
  } catch {}
  const updates = await getTelegramUpdates(token, offset);
  if (!updates) {
    return NextResponse.json({ ok: false, error: "getUpdates 실패" }, { status: 502 });
  }
  const results: string[] = [];
  let nextOffset = offset;
  for (const u of updates) {
    nextOffset = Math.max(nextOffset, u.update_id + 1);
    const outcome = await processTelegramUpdate(u);
    results.push(outcome.info);
  }
  return NextResponse.json({ ok: true, processed: updates.length, next_offset: nextOffset, results });
}
