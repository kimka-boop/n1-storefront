/**
 * N°1 CS — Telegram inbound 상시 소비자 (사고 #A 수정)
 *
 * 사고 경위: 운영자의 실제 Telegram 답장이 Telegram 큐에 쌓인 채 소비되지 않았다
 * (getWebhookInfo pending_update_count 3건 실증). 웹훅 미설정 환경에서 소비는
 * 수동 폴링 호출에 의존했고, 프로세스가 없으면 답장이 고객에게 절대 도달하지 않았다.
 *
 * 계약 (미션 §21·§23):
 * - webhook이 없는 환경에서 이 모듈이 단일 canonical long-poll 소비자가 된다.
 * - 동일 bot에 대한 제2 소비자(getUpdates 409 충돌)를 만들지 않는다 — 수동 /api/telegram/poll은
 *   이 루프의 상태를 조회하는 관찰 엔드포인트로 전환된다.
 * - 처리는 lib/csRelay.processTelegramUpdate 단일 경로(webhook과 동일 코드)를 거친다.
 * - 모든 Telegram 호출은 lib/telegram의 SSRF 가드(고정 호스트 화이트리스트 + https)를 통한다.
 * - 시크릿은 로그에 남지 않는다. 로그에는 update_id와 conversation id만 기록한다.
 *
 * 시작 시점: CS API(/api/chat, /api/cs) 최초 사용 시 lazy start — 상담 요청은 언제나
 * 고객의 웹 활동에서 시작되므로, 운영자가 답장할 시점에는 루프가 이미 떠 있다.
 * (장기: 배포 환경에서는 setWebhook 으로 전환 — 이 모듈은 webhook 유무를 감지해 양보한다.)
 */
import { getTelegramUpdates, getWebhookInfo } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/csRelay";

interface InboundState {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastProcessedUpdateId: number | null;
  confirmedOffset: number; // Telegram에 확인 완료한 offset (마지막 처리 update_id + 1)
  processedCount: number;
  lastError: string | null;
  conflictSince: string | null; // 제2 소비자 충돌(409) 감지 시각
}

declare global {
  // eslint-disable-next-line no-var
  var __csTelegramInbound: InboundState | undefined;
}

const LONG_POLL_SECONDS = 25;
const ERROR_BACKOFF_MS = 5_000;
const CONFLICT_BACKOFF_MS = 30_000;

function state(): InboundState {
  if (!global.__csTelegramInbound) {
    global.__csTelegramInbound = {
      running: false,
      startedAt: null,
      lastTickAt: null,
      lastProcessedUpdateId: null,
      confirmedOffset: 0,
      processedCount: 0,
      lastError: null,
      conflictSince: null,
    };
  }
  return global.__csTelegramInbound;
}

export function inboundStatus(): InboundState {
  return { ...state() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * canonical 소비자를 띄운다 (이미 떠 있으면 no-op).
 * Telegram webhook이 등록되어 있으면 이 프로세스는 getUpdates를 하지 않는다 —
 * webhook과 getUpdates는 동시에 쓸 수 없고(§23), 그때 소비자는 Telegram 자체다.
 */
export async function ensureTelegramInbound(): Promise<void> {
  const st = state();
  if (st.running) return;
  const token = (process.env.N1_CS_BOT_TOKEN || "").trim();
  if (!token) return;

  // webhook 등록 여부 확인 (읽기 전용, lib/telegram SSRF 가드 경유) —
  // 등록되어 있으면 소비 책임을 webhook에 양보한다.
  const info = await getWebhookInfo(token);
  if (info?.webhookUrl) {
    console.log("[cs:audit] event=TELEGRAM_INBOUND_CONSUMER webhook 모드 — 프로세스 폴링 양보");
    return;
  }

  st.running = true;
  st.startedAt = new Date().toISOString();
  console.log("[cs:audit] event=TELEGRAM_INBOUND_CONSUMER_STARTED mode=long_poll");
  void runLoop(token, st);
}

async function runLoop(token: string, st: InboundState): Promise<void> {
  while (st.running) {
    st.lastTickAt = new Date().toISOString();
    try {
      const updates = await getTelegramUpdates(token, st.confirmedOffset, LONG_POLL_SECONDS);
      if (!updates) {
        // 네트워크/일시 오류 — 백오프 후 재시도
        st.lastError = "getUpdates 실패";
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }
      st.lastError = null;
      for (const u of updates) {
        st.lastProcessedUpdateId = u.update_id;
        st.confirmedOffset = Math.max(st.confirmedOffset, u.update_id + 1);
        st.processedCount += 1;
        await processTelegramUpdate(u); // webhook과 동일한 단일 처리 경로 (idempotency 포함)
      }
      st.conflictSince = null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/409|conflict|terminated/i.test(message)) {
        // 제2 소비자 존재 — 미션 §23 위반 상태를 기록하고 길게 백오프한다.
        st.lastError = message;
        if (!st.conflictSince) {
          st.conflictSince = new Date().toISOString();
          console.warn("[cs:audit] event=TELEGRAM_INBOUND_CONFLICT — 다른 getUpdates 소비자 감지, 30s 백오프");
        }
        await sleep(CONFLICT_BACKOFF_MS);
        continue;
      }
      st.lastError = message;
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}
