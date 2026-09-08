/**
 * N°1 CS — 세션 스토어 (V1: 서버 인메모리, 미션 §41 최소 persistence)
 *
 * 저장 필드: conversation_id, status, member/guest 컨텍스트, order refs,
 * messages(sender+provenance 구분), timestamps — 그 이상 저장하지 않는다.
 * 서버 재시작 시 초기화된다 → 클라이언트는 sid가 무효화되면 새 대화를 시작한다.
 * (Sheets/Redis 영속화 계약은 N1_CS_HERMES_HANDOFF.md 참조)
 *
 * P0 data integrity (사고 #B·#C):
 * - 모든 메시지는 id·source(provenance)를 가지며 sender↔source 대응은 저장 계층에서 강제된다.
 * - CUSTOMER 메시지의 유일한 생성 경로는 웹 고객 입력(WEB_CUSTOMER_INPUT)이다.
 * - guest label은 conversation 생성 시 정확히 1회 배정되고 이후 불변이다.
 *   생성 이후의 어떤 이벤트(메시지·escalation·Telegram 전송/재시도·폴링·재마운트)도
 *   새 conversation·새 guest identity를 만들지 않는다 (get-or-create).
 */
import type { ConversationStatus, MessageSource, SenderRole } from "@/lib/cs";
import { validateProvenance } from "@/lib/cs";

export interface CsMessage {
  id: string; // 저장 계층이 부여하는 순차 id (M-1, M-2, …)
  role: SenderRole;
  source: MessageSource; // provenance — CUSTOMER는 WEB_CUSTOMER_INPUT뿐 (HARD INVARIANT)
  text: string;
  ts: string;
  delivered?: boolean; // agent 메시지의 고객 전달 여부 (폴링 마킹)
  telegram?: {
    updateId: number; // 운영자 답장의 Telegram update_id
    messageId: number; // 운영자 답장의 Telegram message_id
    replyToMessageId: number; // 운영자가 답장한 대상 message_id (매핑 근거)
  };
}

export interface CsCustomerContext {
  label: string; // "비회원 3" / "회원 user@mail" — 고객 UI 비노출, 운영자 컨텍스트 전용
  type: "MEMBER" | "GUEST";
  email?: string; // 회원 로그인 이메일 (주문 조인 키)
}

export type ConversationSource = "WEB_CUSTOMER_SESSION" | "TEST_FIXTURE";

export interface CsSession {
  id: string;
  status: ConversationStatus;
  /** conversation 자체의 출처 — 라이브 guest label은 WEB_CUSTOMER_SESSION에서만 발생 (사고 #C) */
  conversationSource: ConversationSource;
  /** N1_CS_TEST_MODE 서버에서 생성된 세션 — Telegram 발송에 [TEST] 마킹 */
  isTest: boolean;
  customer: CsCustomerContext;
  messages: CsMessage[];
  orderRefs: string[]; // 최근순 아님 — 발견 순. 마지막이 활성 컨텍스트
  greetSent: boolean;
  dissatisfiedStreak: number;
  /**
   * 이 conversation과 연관된 Telegram message_id 전부 (reply 매핑의 source of truth).
   * escalation 전체 청크 + HUMAN_* 중 고객 후속 알림까지 — 메시지 패밀리 전체가
   * 동일 conversation에 매핑된다. 운영자가 이 중 무엇에 답장해도 같은 고객으로 라우팅.
   */
  telegramMsgIds: number[];
  escalated: boolean;
  /** §31·32 — spam gate/cooldown 경량 메타 (대화 원문 외 최소) */
  spam?: {
    recent: { norm: string; ts: number }[]; // 최근 정규화 메시지 지문
    cooldownUntil: number; // epoch ms — 이 시각까지 deterministic 단기 응답만
    lastFallback: string; // 직전 fallback 문구 (동일 문구 연속 방지)
  };
  createdAt: string;
  updatedAt: string;
}

export interface CsStore {
  sessions: Record<string, CsSession>;
  counter: number;
  guestCounter: number;
  messageCounter: number;
  /**
   * 클라이언트 세션 키(opaque) → conversation id.
   * 첫 POST 응답 전에 다음 메시지가 와도(전형적 rapid-send race) 같은 키면
   * 반드시 같은 conversation으로 합쳐진다 — phantom guest 봉쇄 (사고 #C, 부칙 §20·§21).
   */
  sessionKeys: Map<string, string>;
  /** §17 idempotency — Telegram update/message 1회 처리 가드 (프로세스 수명 동안 유지) */
  telegram: {
    seenUpdates: Map<number, number>; // update_id → 처리 시각
    seenMessages: Map<number, number>; // 운영자 message_id → 처리 시각
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __csStore: CsStore | undefined;
}

const GUARD_LIMIT = 1000;

function pruneGuard(map: Map<number, number>): void {
  while (map.size > GUARD_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** update_id 1회 처리 가드 — false면 이미 처리된 중복 (재처리 금지) */
export function markUpdateSeen(store: CsStore, updateId: number): boolean {
  if (!Number.isFinite(updateId)) return true;
  if (store.telegram.seenUpdates.has(updateId)) return false;
  store.telegram.seenUpdates.set(updateId, Date.now());
  pruneGuard(store.telegram.seenUpdates);
  return true;
}

/** 운영자 message_id 1회 처리 가드 — webhook/poll이 겹쳐도 고객 이중 전달이 없게 한다 */
export function markOperatorMessageSeen(store: CsStore, messageId: number): boolean {
  if (!Number.isFinite(messageId)) return true;
  if (store.telegram.seenMessages.has(messageId)) return false;
  store.telegram.seenMessages.set(messageId, Date.now());
  pruneGuard(store.telegram.seenMessages);
  return true;
}

export function getStore(): CsStore {
  if (!global.__csStore) {
    global.__csStore = {
      sessions: {},
      counter: 0,
      guestCounter: 0,
      messageCounter: 0,
      sessionKeys: new Map(),
      telegram: { seenUpdates: new Map(), seenMessages: new Map() },
    };
  }
  const store = global.__csStore;
  if (!store.telegram) store.telegram = { seenUpdates: new Map(), seenMessages: new Map() };
  if (!store.sessionKeys) store.sessionKeys = new Map();
  return store;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * get-or-create (session-key 우선) — phantom guest의 최종 봉쇄선 (사고 #C).
 *
 * 클라이언트는 탭 세션당 opaque session_key를 1회 생성해 모든 메시지에 실어 보낸다.
 * 서버는 키로 기존 conversation을 찾아 재사용하고, 없을 때만 새로 만들어 바인딩한다.
 * → 첫 요청 응답 지연 중에 몇 개의 메시지가 몰려와도(StrictMode 이중 전송 포함)
 *   conversation은 정확히 1개, guest label도 정확히 1개다 (부칙 §20·§21·§46).
 */
export function resolveOrCreateSession(
  store: CsStore,
  sessionKey: string | null | undefined,
  sid: string | null | undefined,
  customer?: { email?: string; member?: boolean },
): CsSession {
  const key = sessionKey && sessionKey.trim() ? sessionKey.trim().slice(0, 64) : null;
  if (key) {
    const boundId = store.sessionKeys.get(key);
    const bound = boundId ? store.sessions[boundId] : undefined;
    if (bound) return ensureSession(store, bound.id, customer); // 기존 conversation 재사용 (label 불변)
  }
  // 키에 바인딩된 conversation이 없을 때만 생성 경로로 진입한다 (1회).
  const session = ensureSession(store, key ? null : sid, customer);
  if (key) store.sessionKeys.set(key, session.id);
  return session;
}

/**
 * get-or-create — sid가 있으면 반드시 기존 세션을 반환한다.
 * 새 guest label은 "실제 웹 세션의 새 conversation" 생성 시점에 정확히 1회 배정되며,
 * 이후 어떤 이벤트(재요청·재시도·재마운트)도 새 identity를 만들지 않는다 (사고 #C).
 * 라이브 경로는 /api/chat(웹 고객 입력)뿐이다 — Telegram/LLM/테스트 워커는 세션을 만들 수 없다.
 */
export function ensureSession(
  store: CsStore,
  sid: string | null | undefined,
  customer?: { email?: string; member?: boolean },
): CsSession {
  const existing = sid ? store.sessions[sid] : undefined;
  if (existing) {
    if (customer?.member && customer.email) {
      existing.customer.type = "MEMBER";
      existing.customer.email = customer.email.toLowerCase();
      existing.customer.label = `회원 ${existing.customer.email}`;
    }
    console.log(`[cs:audit] event=EXISTING_CONVERSATION_REUSED conversation=${existing.id}`);
    return existing;
  }
  // 운영자 컨텍스트용 conversation id — Telegram 상담 요청에 그대로 표시된다 (CS-001, CS-002, …)
  const id = sid && sid.trim() ? sid.trim() : `CS-${String(++store.counter).padStart(3, "0")}`;
  const isMember = Boolean(customer?.member && customer.email);
  const email = isMember ? String(customer!.email).toLowerCase() : undefined;
  const isTest = process.env.N1_CS_TEST_MODE === "1";
  const session: CsSession = {
    id,
    status: "NEW",
    conversationSource: "WEB_CUSTOMER_SESSION", // 세션은 오직 실제 웹 고객 경로에서 생성된다
    isTest,
    customer: {
      label: isMember ? `회원 ${email}` : `비회원 ${++store.guestCounter}`, // 1회 배정, 이후 불변
      type: isMember ? "MEMBER" : "GUEST",
      email,
    },
    messages: [],
    orderRefs: [],
    greetSent: false,
    dissatisfiedStreak: 0,
    telegramMsgIds: [],
    escalated: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.sessions[id] = session;
  console.log(
    `[cs:audit] event=CONVERSATION_CREATED conversation=${id} source=${session.conversationSource} is_test=${isTest} guest_label=${session.customer.label}`,
  );
  return session;
}

/**
 * provenance 가드가 적용된 유일한 메시지 저장 경로.
 * sender↔source 대응 위반(예: customer+TELEGRAM_HUMAN_REPLY)은 예외로 거부된다 —
 * 고객 발화는 웹 입력뿐이고, 운영자 발화는 Telegram reply뿐이다 (사고 #B).
 */
export function appendMessage(
  session: CsSession,
  role: SenderRole,
  text: string,
  source: MessageSource,
  telegram?: CsMessage["telegram"],
): CsMessage {
  validateProvenance(role, source, session.isTest);
  const store = getStore();
  const msg: CsMessage = {
    id: `M-${++store.messageCounter}`,
    role,
    source,
    text,
    ts: nowIso(),
    ...(telegram ? { telegram } : {}),
  };
  session.messages.push(msg);
  session.updatedAt = msg.ts;
  return msg;
}

/** 웹 고객 입력 전용 — CUSTOMER 메시지의 유일한 생성 경로 (§14) */
export function appendWebCustomerMessage(session: CsSession, text: string): CsMessage {
  console.log(`[cs:audit] event=CUSTOMER_WEB_MESSAGE_RECEIVED conversation=${session.id}`);
  return appendMessage(session, "customer", text, "WEB_CUSTOMER_INPUT");
}

/** AI 응답 전용 */
export function appendAiMessage(session: CsSession, text: string): CsMessage {
  return appendMessage(session, "ai", text, "AI_GENERATION");
}

/** 운영자 Telegram 답장 전용 — verbatim 원문 + Telegram 상관 id 기록 (§24) */
export function appendHumanOperatorMessage(
  session: CsSession,
  text: string,
  telegram: { updateId: number; messageId: number; replyToMessageId: number },
): CsMessage {
  const msg = appendMessage(session, "agent", text, "TELEGRAM_HUMAN_REPLY", telegram);
  console.log(`[cs:audit] event=HUMAN_MESSAGE_PERSISTED conversation=${session.id} message=${msg.id}`);
  return msg;
}

/** 시스템 안내 전용 */
export function appendSystemMessage(session: CsSession, text: string): CsMessage {
  return appendMessage(session, "system", text, "SYSTEM_EVENT");
}
