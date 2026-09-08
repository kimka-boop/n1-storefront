/**
 * [Telegram CS 봇 수신 웹훅]
 * POST /api/telegram/webhook — Telegram update 수신 → 운영자 답장을 고객 대화에 VERBATIM 릴레이
 *
 * 설정 (배포 시):
 *   env N1_CS_BOT_TOKEN / N1_CS_CHAT_ID — CS 전담 봇(봇3) 토큰/운영 채널
 *   env N1_CS_WEBHOOK_SECRET — (권장) Telegram setWebhook secret_token 과 일치 확인
 *   setWebhook url: https://<도메인>/api/telegram/webhook
 *
 * 보안: 시크릿 헤더 불일치·릴레이 채널 외부 발신은 조용히 무시한다 (토큰 등 시크릿 응답 금지).
 */
import { NextResponse } from "next/server";
import { processTelegramUpdate } from "@/lib/csRelay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const secret = process.env.N1_CS_WEBHOOK_SECRET;
    if (secret) {
      const header = req.headers.get("x-telegram-bot-api-secret-token");
      if (header !== secret) {
        return NextResponse.json({ ok: false }, { status: 401 });
      }
    }
    const update = await req.json();
    const outcome = await processTelegramUpdate(update);
    return NextResponse.json({ ok: outcome.handled, info: outcome.info });
  } catch (e: unknown) {
    console.error("[telegram/webhook]", e instanceof Error ? e.message : e);
    // Telegram 재시도 폭주 방지 — 처리 실패도 200으로 흡수하고 로그로 남긴다
    return NextResponse.json({ ok: false });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    setup: [
      "1) env: N1_CS_BOT_TOKEN, N1_CS_CHAT_ID 설정 (필수), N1_CS_WEBHOOK_SECRET (권장)",
      "2) Telegram: setWebhook url=https://<도메인>/api/telegram/webhook (secret_token 옵션 권장)",
      "3) 로컬/웹훅 미설정 환경은 POST /api/telegram/poll 로 수동 폴링",
    ],
  });
}
