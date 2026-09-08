/**
 * [Telegram CS 봇 inbound 관찰 엔드포인트]
 * GET /api/telegram/poll → 상시 소비자(단일 canonical long-poll) 상태 조회
 *
 * 사고 #A 이후 이 엔드포인트는 getUpdates를 직접 호출하지 않는다 —
 * 동일 bot에 대한 getUpdates 소비자는 정확히 하나(프로세스 내 상시 루프 또는
 * 등록된 webhook)여야 하며(미션 §23), 과거의 수동 폴링은 제2 소비자 충돌과
 * "운영자 답장이 큐에 방치" 사고(소비자 부재)의 원인이었다.
 * 소비 상태 확인/진단 용도로만 남긴다.
 */
import { NextResponse } from "next/server";
import { ensureTelegramInbound, inboundStatus } from "@/lib/telegramInbound";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureTelegramInbound();
  const st = inboundStatus();
  return NextResponse.json({
    ok: true,
    consumer: st.running ? "process_long_poll" : st.lastError ? "error_backoff" : "not_started",
    started_at: st.startedAt,
    last_tick_at: st.lastTickAt,
    last_processed_update_id: st.lastProcessedUpdateId,
    confirmed_offset: st.confirmedOffset,
    processed_count: st.processedCount,
    last_error: st.lastError,
    conflict_since: st.conflictSince,
  });
}

export async function POST() {
  return GET();
}
