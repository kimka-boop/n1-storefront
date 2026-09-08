/**
 * N°1 CS — Telegram 운영자 답장 → 고객 VERBATIM 릴레이 (미션 §27·§28·§29)
 *
 * 매핑 우선순위:
 *   1) 운영자가 티켓 메시지에 '답장(reply)'한 경우 → 해당 conversation
 *   2) HUMAN_PENDING/HUMAN_ACTIVE 대화가 정확히 1개 → 그 대화
 *   3) 그 외 → 지정 요청 안내 (추측 라우팅 금지)
 *
 * AI는 상담원 답변을 요약·교정·완곡화하지 않고 원문 그대로 전달한다.
 */
import { appendMessage, getStore, type CsSession } from "@/lib/csStore";
import { sendTelegramMessage } from "@/lib/telegram";

export interface RelayOutcome {
  handled: boolean;
  info: string;
}

const USAGE_HINT = [
  "N°1 CS 릴레이 봇입니다.",
  "티켓 메시지에 '답장'하면 해당 고객에게 원문 그대로 전달됩니다.",
  "대화가 1개뿐이면 답장 없이 입력해도 그 대화로 전달됩니다.",
  "/ai — 해당 대화를 AI 상담으로 다시 넘기기",
].join("\n");

function humanSessions(): CsSession[] {
  const store = getStore();
  return Object.values(store.sessions).filter(
    (s) => s.status === "HUMAN_PENDING" || s.status === "HUMAN_ACTIVE",
  );
}

function sessionByTelegramMessage(messageId: number): CsSession | null {
  const store = getStore();
  for (const s of Object.values(store.sessions)) {
    if (s.telegramMsgIds.includes(messageId)) return s;
  }
  return null;
}

export async function processTelegramUpdate(update: {
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number | string };
    reply_to_message?: { message_id: number };
  };
}): Promise<RelayOutcome> {
  const msg = update.message;
  if (!msg || typeof msg.text !== "string" || !msg.text.trim()) {
    return { handled: false, info: "텍스트 메시지 아님" };
  }
  const text = msg.text.trim();

  // ── 명령
  if (text === "/start" || text === "/help") {
    await replyToOperator(msg.chat?.id, USAGE_HINT);
    return { handled: true, info: "usage hint 발송" };
  }

  // ── /ai: AI 상담으로 복귀 (미션 §29 명시적 control)
  if (text === "/ai") {
    const target = resolveTarget(msg);
    if (!target.session) {
      await replyToOperator(msg.chat?.id, target.hint || "대상 대화를 특정할 수 없습니다 — 티켓 메시지에 답장해 주세요.");
      return { handled: false, info: "target 없음" };
    }
    target.session.status = "AI_ACTIVE";
    appendMessage(target.session, "system", "상담원이 확인을 마치고 AI 상담으로 전환했습니다. 이어서 도움을 드리겠습니다.");
    await replyToOperator(msg.chat?.id, `✓ ${target.session.id} → AI 상담 전환`);
    return { handled: true, info: `ai 전환: ${target.session.id}` };
  }

  // ── 일반 텍스트 → 고객에게 VERBATIM 전달
  const target = resolveTarget(msg);
  if (!target.session) {
    await replyToOperator(msg.chat?.id, target.hint || "대상 대화를 특정할 수 없습니다 — 티켓 메시지에 답장해 주세요.");
    return { handled: false, info: "target 없음" };
  }
  appendMessage(target.session, "agent", msg.text); // 원문 그대로 (요약/수정/교정 없음)
  target.session.status = "HUMAN_ACTIVE";
  return { handled: true, info: `전달됨: ${target.session.id}` };
}

function resolveTarget(msg: { reply_to_message?: { message_id: number } }): {
  session: CsSession | null;
  hint?: string;
} {
  // 1) 티켓 원문에 대한 답장 매핑
  if (msg.reply_to_message?.message_id) {
    const byReply = sessionByTelegramMessage(msg.reply_to_message.message_id);
    if (byReply) return { session: byReply };
  }
  // 2) 활성 대화가 정확히 1개일 때만 자동 라우팅
  const actives = humanSessions();
  if (actives.length === 1) return { session: actives[0] };
  if (actives.length === 0) {
    return { session: null, hint: "대기 중인 상담이 없습니다." };
  }
  return {
    session: null,
    hint: `대기 중인 대화가 ${actives.length}개입니다 — 전달할 티켓 메시지에 '답장'해 주세요.`,
  };
}

/** 운영자 채널 응답 (chat id는 봇 채널과 일치할 때만 — 외부 입력으로 발송하지 않는다) */
async function replyToOperator(chatId: number | string | undefined, text: string): Promise<void> {
  const token = process.env.N1_CS_BOT_TOKEN || "";
  const chat = process.env.N1_CS_CHAT_ID || "";
  if (!token || !chat || chatId === undefined) return;
  if (String(chatId) !== String(chat)) return; // 릴레이 채널 외부에서 온 명령에는 응답하지 않음
  await sendTelegramMessage(token, chat, text);
}
