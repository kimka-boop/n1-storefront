/**
 * N°1 CS — Telegram 운영자 답장 → 고객 VERBATIM 릴레이 (P0: reply-to 단일 라우팅)
 *
 * 라우팅 규칙 (미션 §2·§5·§9·§13·§14):
 *   reply_to_message.message_id → conversation 매핑이 유일한 라우팅 근거다.
 *   - 답장 없는 standalone 메시지 → 어느 고객에게도 전달 금지, 안내 응답
 *   - 답장했으나 미매핑 message   → 어느 고객에게도 전달 금지, 안내 응답
 *   - "유일한 HUMAN_PENDING", "최근 상담" 등 추측 라우팅 금지 (해석·휴리스틱 없음 — deterministic)
 *
 * 그 외 (미션 §4·§15·§17·§20):
 *   - 릴레이 채널(HERMES 관리 N1_CS_CHAT_ID) 외부 발신은 처리하지 않는다 (설정 없으면 fail-closed).
 *   - update_id / message_id 가드로 중복 처리·이중 전달을 막는다.
 *   - 운영자 원문은 요약·교정·trim 없이 그대로 저장·전달한다 (LLM 호출 0).
 */
import {
  appendHumanOperatorMessage,
  appendSystemMessage,
  getStore,
  markOperatorMessageSeen,
  markUpdateSeen,
  type CsSession,
} from "@/lib/csStore";
import { sendTelegramMessage } from "@/lib/telegram";

export interface RelayOutcome {
  handled: boolean;
  /** 고객 conversation에 실제로 기록(전달)되었는가 */
  delivered?: boolean;
  info: string;
}

export const STANDALONE_GUIDANCE = [
  "어느 상담에 대한 답변인지 확인할 수 없습니다.",
  "답변할 고객의 상담 요청 메시지에서 '답장(Reply)' 기능을 사용해주세요.",
].join("\n");

export const UNMAPPED_GUIDANCE = [
  "연결된 N°1 상담을 찾지 못했습니다.",
  "해당 고객의 상담 요청 메시지에 답장해주세요.",
].join("\n");

const USAGE_HINT = [
  "N°1 CS 릴레이 봇입니다.",
  "상담 요청 메시지에 '답장(Reply)'하면 해당 고객에게 원문 그대로 전달됩니다.",
  "답장 없이 보낸 메시지는 어느 고객에게도 전달되지 않습니다.",
  "/ai — 답장한 대화를 AI 상담으로 다시 넘기기",
].join("\n");

export interface OperatorMessage {
  message_id: number;
  text?: string;
  from?: { id?: number; username?: string };
  chat?: { id: number | string };
  reply_to_message?: { message_id: number };
}

/** authorized operator 채널 — HERMES가 주입한 운영 설정 (값은 이 모듈 밖으로 노출 금지) */
function authorizedChatId(): string {
  return (process.env.N1_CS_CHAT_ID || "").trim();
}

/** §15 — 설정된 운영 채널 발신만 처리. 선택 N1_CS_OPERATOR_IDS 로 발신자까지 한정. */
function isAuthorized(msg: OperatorMessage): boolean {
  const chat = authorizedChatId();
  if (!chat) return false; // 운영 채널 미설정 → 전달 경로 자체를 닫는다 (fail-closed)
  if (String(msg.chat?.id ?? "") !== chat) return false;
  const allow = (process.env.N1_CS_OPERATOR_IDS || "").trim();
  if (allow) {
    const ids = allow.split(",").map((s) => s.trim()).filter(Boolean);
    const fromId = msg.from?.id;
    if (!fromId || !ids.includes(String(fromId))) return false;
  }
  return true;
}

export async function processTelegramUpdate(update: {
  update_id?: number;
  message?: OperatorMessage;
}): Promise<RelayOutcome> {
  const store = getStore();
  const msg = update.message;

  // §17 — update 1회 처리 가드 (Telegram 재전송, webhook/poll 겹침 모두 흡수)
  if (typeof update.update_id === "number" && !markUpdateSeen(store, update.update_id)) {
    return { handled: true, delivered: false, info: "중복 update — 스킵" };
  }
  if (!msg || typeof msg.text !== "string" || !msg.text.trim()) {
    return { handled: false, delivered: false, info: "텍스트 메시지 아님" };
  }
  // §17 — 동일 message_id 재도착 가드 (update_id가 달라져도 이중 전달 금지)
  if (!markOperatorMessageSeen(store, msg.message_id)) {
    return { handled: true, delivered: false, info: "중복 message — 스킵" };
  }
  // §15 — authorized operator가 아닌 발신은 조용히 무시 (응답도 보내지 않는다)
  if (!isAuthorized(msg)) {
    console.warn(`[cs:audit] event=UNAUTHORIZED_SENDER_IGNORED telegram_message=${msg.message_id}`);
    return { handled: false, delivered: false, info: "미인가 발신 — 무시" };
  }

  const raw = msg.text; // 원문 그대로 — trim/정규화하지 않는다 (§20)

  // ── 운영자 명령 (고객 전달 대상 아님)
  if (raw === "/start" || raw === "/help") {
    await replyToOperator(msg, USAGE_HINT);
    return { handled: true, delivered: false, info: "usage hint 발송" };
  }
  if (raw === "/ai") {
    const target = resolveByReply(msg);
    if (!target.session) {
      await replyToOperator(msg, target.guidance || UNMAPPED_GUIDANCE, msg.message_id);
      return { handled: false, delivered: false, info: "target 없음" };
    }
    target.session.status = "AI_ACTIVE";
    appendSystemMessage(target.session, "상담원이 확인을 마치고 AI 상담으로 전환했습니다. 이어서 도움을 드리겠습니다.");
    await replyToOperator(msg, `✓ ${target.session.id} → AI 상담 전환`, msg.message_id);
    return { handled: true, delivered: false, info: `ai 전환: ${target.session.id}` };
  }

  // ── 일반 텍스트: reply-to 매핑만이 고객 전달 경로다 (§9)
  const target = resolveByReply(msg);
  if (!target.session) {
    // §14 — 미매핑·standalone은 어느 고객에게도 기록하지 않는다.
    //       이 안내 텍스트는 운영자 응답이지 고객 메시지의 출처가 아니다 (사고 #B).
    await replyToOperator(msg, target.guidance || UNMAPPED_GUIDANCE, msg.message_id);
    console.warn(
      `[cs:audit] event=TELEGRAM_REPLY_UNMAPPED conversation=- telegram_message=${msg.message_id} kind=${target.guidance === STANDALONE_GUIDANCE ? "standalone" : "unmapped"}`,
    );
    return { handled: false, delivered: false, info: target.guidance === STANDALONE_GUIDANCE ? "standalone — 전달 없음" : "미매핑 reply — 전달 없음" };
  }
  // FIRST: persist (HUMAN_OPERATOR / TELEGRAM_HUMAN_REPLY provenance + 상관 id) → THEN: 고객 전달 (§24)
  appendHumanOperatorMessage(target.session, raw, {
    updateId: typeof update.update_id === "number" ? update.update_id : 0,
    messageId: msg.message_id,
    replyToMessageId: msg.reply_to_message?.message_id ?? 0,
  }); // VERBATIM — 요약·교정·완곡화 없음 (§38, LLM 호출 0)
  target.session.status = "HUMAN_ACTIVE"; // §26 — 첫 성공 전달로 HUMAN_PENDING → HUMAN_ACTIVE
  console.log(`[cs:audit] event=HUMAN_REPLY_MAPPED conversation=${target.session.id} telegram_message=${msg.message_id}`);
  await replyToOperator(msg, `✓ ${target.session.id} 고객에게 전달했습니다.`, msg.message_id);
  return { handled: true, delivered: true, info: `전달됨: ${target.session.id}` };
}

/**
 * §2·§9·§13 — reply_to_message.message_id 만이 라우팅 근거.
 * conversation 관련 Telegram 메시지 전체(escalation 전체 청크 + 후속 알림)가
 * telegramMsgIds 에 매핑되어 있으므로, 그중 무엇에 답장해도 같은 고객에게 전달된다.
 */
function resolveByReply(msg: OperatorMessage): { session: CsSession | null; guidance?: string } {
  const replied = msg.reply_to_message?.message_id;
  if (!replied) return { session: null, guidance: STANDALONE_GUIDANCE };
  const store = getStore();
  for (const s of Object.values(store.sessions)) {
    if (s.telegramMsgIds.includes(replied)) return { session: s };
  }
  return { session: null, guidance: UNMAPPED_GUIDANCE };
}

/** 운영자 채널 응답 — authorized 채널로만 발송하며, 가능하면 운영자 메시지에 답장으로 스레드를 맞춘다 */
async function replyToOperator(msg: OperatorMessage | null, text: string, replyToMessageId?: number): Promise<void> {
  const token = process.env.N1_CS_BOT_TOKEN || "";
  const chat = authorizedChatId();
  if (!token || !chat) return;
  if (msg && msg.chat !== undefined && String(msg.chat.id ?? "") !== chat) return;
  await sendTelegramMessage(token, chat, text, replyToMessageId);
}
