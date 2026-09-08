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
  telegramMsgIds: number[]; // escalation 원문 메시지 앵커 (운영자 reply 매핑)
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CsStore {
  sessions: Record<string, CsSession>;
  counter: number;
  guestCounter: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __csStore: CsStore | undefined;
}

export function getStore(): CsStore {
  if (!global.__csStore) global.__csStore = { sessions: {}, counter: 100, guestCounter: 0 };
  return global.__csStore;
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
  const id = sid && sid.trim() ? sid.trim() : `#SESS_${++store.counter}`;
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
