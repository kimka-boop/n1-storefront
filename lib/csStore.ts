/**
 * N°1 CS — 세션 스토어 (V1: 서버 인메모리, 미션 §41 최소 persistence)
 *
 * 저장 필드: conversation_id, status, member/guest 컨텍스트, order refs,
 * messages(sender 구분), timestamps — 그 이상 저장하지 않는다.
 * 서버 재시작 시 초기화된다 → 클라이언트는 sid가 무효화되면 새 대화를 시작한다.
 * (Sheets/Redis 영속화 계약은 N1_CS_HERMES_HANDOFF.md 참조)
 */
import type { ConversationStatus, SenderRole } from "@/lib/cs";

export interface CsMessage {
  role: SenderRole;
  text: string;
  ts: string;
  delivered?: boolean; // agent 메시지의 고객 전달 여부 (폴링 마킹)
}

export interface CsCustomerContext {
  label: string; // "비회원 3" / "회원 user@mail" — 고객 UI 비노출, 운영자 컨텍스트 전용
  type: "MEMBER" | "GUEST";
  email?: string; // 회원 로그인 이메일 (주문 조인 키)
}

export interface CsSession {
  id: string;
  status: ConversationStatus;
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
      telegram: { seenUpdates: new Map(), seenMessages: new Map() },
    };
  }
  const store = global.__csStore;
  if (!store.telegram) store.telegram = { seenUpdates: new Map(), seenMessages: new Map() };
  return store;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** sid로 세션 조회 — 없으면 같은 sid로 새 세션 (클라이언트 대화 연속성 유지) */
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
    return existing;
  }
  // 운영자 컨텍스트용 conversation id — Telegram 상담 요청에 그대로 표시된다 (CS-001, CS-002, …)
  const id = sid && sid.trim() ? sid.trim() : `CS-${String(++store.counter).padStart(3, "0")}`;
  const isMember = Boolean(customer?.member && customer.email);
  const email = isMember ? String(customer!.email).toLowerCase() : undefined;
  const session: CsSession = {
    id,
    status: "NEW",
    customer: {
      label: isMember ? `회원 ${email}` : `비회원 ${++store.guestCounter}`,
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
  return session;
}

export function appendMessage(session: CsSession, role: SenderRole, text: string): CsMessage {
  const msg: CsMessage = { role, text, ts: nowIso() };
  session.messages.push(msg);
  session.updatedAt = msg.ts;
  return msg;
}
