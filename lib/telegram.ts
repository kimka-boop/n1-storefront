/**
 * N°1 Telegram 공용 발송 계층 (봇2 결제알림 / 봇3 CS상담 공용)
 *
 * SSRF 가드: 엔드포인트는 고정 호스트 화이트리스트(api.telegram.org) + https 만 허용.
 * 토큰·채팅ID는 env 배포 시크릿이며 이 모듈 밖으로 노출하지 않는다 (미션 §48).
 * 실패는 ok:false 로 정직하게 반환 — 호출자가 거짓 성공으로 포장하지 않는다 (미션 §47).
 */

const TELEGRAM_ORIGIN = "https://api.telegram.org";
const ALLOWED_HOST = "api.telegram.org";

function buildApiUrl(token: string, method: string): URL | null {
  const url = new URL(TELEGRAM_ORIGIN);
  url.pathname = `/bot${token}/${method}`;
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) return null;
  return url;
}

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  /** 발송된 모든 청크의 message_id — conversation 매핑 앵커 전체 (운영자가 어느 청크에 답장해도 라우팅) */
  messageIds?: number[];
}

/** sendMessage — 성공 시 Telegram message_id 반환 (운영자 답장 매핑용) */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<TelegramSendResult> {
  if (!token || !chatId || !text) return { ok: false };
  const url = buildApiUrl(token, "sendMessage");
  if (!url) return { ok: false };
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  };
  if (replyToMessageId) {
    // 원래 스레드에 연결 (원본이 삭제되어도 전송 자체는 계속)
    body.reply_parameters = { message_id: replyToMessageId, allow_sending_without_reply: true };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json().catch(() => null);
    const messageId = data?.result?.message_id;
    if (typeof messageId !== "number") return { ok: true };
    return { ok: true, messageId, messageIds: [messageId] };
  } catch {
    return { ok: false };
  }
}

/**
 * 긴 텍스트를 Telegram 4096자 제한에 맞춰 분할 발송.
 * 헤더가 잘리지 않도록 줄 단위로 쪼갠다. 순서 보장을 위해 순차 발송.
 * messageIds는 모든 청크의 message_id — 전부 conversation에 매핑해야
 * 운영자가 마지막 청크에 답장해도 올바른 고객에게 라우팅된다.
 */
export async function sendTelegramLong(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<TelegramSendResult> {
  const MAX = 3800;
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > MAX) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += MAX) chunks.push(line.slice(i, i + MAX));
      continue;
    }
    if (current.length + line.length + 1 > MAX) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) return { ok: false };
  const ids: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await sendTelegramMessage(token, chatId, chunks[i], replyToMessageId);
    if (!r.ok) return { ok: false, messageId: ids[0], messageIds: ids };
    if (r.messageId !== undefined) ids.push(r.messageId);
  }
  return { ok: true, messageId: ids[0], messageIds: ids };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id?: number; username?: string };
    chat?: { id: number | string };
    reply_to_message?: { message_id: number };
  };
}

/** getUpdates (long polling) — webhook 미설정 환경 폴백 */
/** getWebhookInfo (읽기 전용) — inbound 소비자가 webhook 등록 여부를 확인할 때 사용 */
export async function getWebhookInfo(token: string): Promise<{ ok: boolean; webhookUrl?: string; pendingUpdateCount?: number } | null> {
  const url = buildApiUrl(token, "getWebhookInfo");
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.ok) return null;
    return {
      ok: true,
      webhookUrl: typeof data.result?.url === "string" && data.result.url ? data.result.url : undefined,
      pendingUpdateCount: typeof data.result?.pending_update_count === "number" ? data.result.pending_update_count : undefined,
    };
  } catch {
    return null;
  }
}

export async function getTelegramUpdates(token: string, offset: number, timeoutSec = 0): Promise<TelegramUpdate[] | null> {
  const url = buildApiUrl(token, "getUpdates");
  if (!url) return null;
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", String(timeoutSec));
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.result) ? (data.result as TelegramUpdate[]) : null;
  } catch {
    return null;
  }
}
