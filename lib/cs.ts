/**
 * N°1 AI CS — 대화 상태 머신 · 권한 경계 · 주문번호 인식 · 프라이버시 (순수 로직)
 *
 * 원칙 (미션 §17–§46):
 * - scripted welcome은 conversation당 1회, 이후 인사는 문맥 응답
 * - 조회/설명(READ) 중심 — 권한 밖 판단·쓰기는 Human escalation
 * - 검증된 데이터만 답한다. 없으면 "모른다"를 말하거나 상담원에게 넘긴다 (추측 금지)
 * - 주문번호만으로 민감정보 노출 금지 — 비민감 요약만, 민감정보는 본인확인 후
 */

// ───────────────────────── 상태 ─────────────────────────

export type ConversationStatus =
  | "NEW" // 대화 시작 전 (첫 고객 메시지 전)
  | "GREETED" // scripted welcome 발송됨
  | "AI_ACTIVE" // AI가 문맥 기반 응대 중
  | "ORDER_CONTEXT" // 주문 컨텍스트 확보 (AI 응대 지속)
  | "HUMAN_PENDING" // 상담원 연결 요청됨
  | "HUMAN_ACTIVE" // 상담원 응대 중
  | "RESOLVED"; // 종료

export type SenderRole = "customer" | "ai" | "agent" | "system";

// ───────────────────── 메시지 출처 (P0 data integrity) ─────────────────────
//
// 모든 CS 메시지는 명시적 provenance를 가진다. HARD INVARIANT:
//   sender=customer  ⇔ source=WEB_CUSTOMER_INPUT  (실제 웹 고객 입력뿐)
//   sender=ai        ⇔ source=AI_GENERATION
//   sender=agent     ⇔ source=TELEGRAM_HUMAN_REPLY (실제 운영자 Telegram 답장뿐)
//   sender=system    ⇔ source=SYSTEM_EVENT
// TEST_FIXTURE는 세션이 is_test일 때만 허용된다. 위반 insert는 저장 계층에서
// 예외로 거부한다 — 고객 발화는 절대 생성·대리 기록될 수 없다 (사고 #B).

export type MessageSource =
  | "WEB_CUSTOMER_INPUT" // 실제 Customer Center에서 고객이 직접 전송 (유일한 CUSTOMER 출처)
  | "AI_GENERATION" // AI CS 응답 생성
  | "TELEGRAM_HUMAN_REPLY" // 운영자의 실제 Telegram reply (원문 verbatim)
  | "SYSTEM_EVENT" // 시스템 상태 안내
  | "TEST_FIXTURE"; // 명시된 테스트 전용 (is_test 세션 한정)

/** sender role ↔ 허용 source 대응표 — 저장 계층 강제용 */
export const PROVENANCE_RULE: Record<SenderRole, MessageSource[]> = {
  customer: ["WEB_CUSTOMER_INPUT", "TEST_FIXTURE"],
  ai: ["AI_GENERATION"],
  agent: ["TELEGRAM_HUMAN_REPLY"],
  system: ["SYSTEM_EVENT"],
};

/** provenance 검증 — 위반 시 예외 (server-side guard, 사고 #B 재발 방지) */
export function validateProvenance(role: SenderRole, source: MessageSource, isTestSession: boolean): void {
  if (!PROVENANCE_RULE[role].includes(source)) {
    throw new Error(`[cs] provenance 위반 거부: sender=${role} source=${source}`);
  }
  if (source === "TEST_FIXTURE" && !isTestSession) {
    throw new Error("[cs] provenance 위반 거부: TEST_FIXTURE는 is_test 세션에서만 허용");
  }
}

/** 운영 Telegram 피드의 테스트 구분 마킹 — is_test 세션의 발송에만 붙는다 */
export function testPrefix(isTest: boolean): string {
  return isTest ? "[TEST] " : "";
}

export const AI_GREETING = [
  "안녕하세요, N°1 고객센터입니다.",
  "주문·배송, 사이즈·핏, 소재·세탁 등 궁금한 내용을 편하게 남겨주세요.",
  "필요하면 전문 상담원도 연결해드릴게요.",
].join("\n");

export const SECOND_GREETING = "네, 안녕하세요 :) 무엇을 도와드릴까요?";

export const ESCALATION_NOTICE = [
  "전문 상담원에게 연결하겠습니다.",
  "처리량에 따라 대기 시간이 필요할 수 있습니다.",
  "지금까지의 대화 내용은 상담원에게 함께 전달됩니다.",
].join(" ");

export const LOOKUP_FAILURE_NOTICE = "지금 주문 정보를 바로 확인하지 못해 상담원에게 확인을 요청하겠습니다.";

export const AI_FALLBACK_NOTICE = "지금 자동 상담 연결이 원활하지 않아 전문 상담원에게 바로 전달하겠습니다.";

// ───────────────────── 주문번호 인식 ─────────────────────

/** ORD-YYYYMMDD-XXXXX 정식 형식 또는 주문 맥락어와 붙은 4~8자리 번호 */
export function extractOrderNumber(message: string): string | null {
  const msg = (message || "").trim();
  // 1) 정식 주문번호 형식
  const formal = msg.match(/\bORD-\d{8}-\d{5}\b/);
  if (formal) return formal[0];
  // 2) 주문 맥락어 근처의 숫자 (전화번호/가격 오탐 방지를 위해 키워드 인접만)
  const near = msg.match(/(?:주문번호|주문\s*번호|주문\b)[^\d]{0,12}(\d{4,8})/);
  if (near) return near[1];
  // 3) "12345 주문" 처럼 뒤에 오는 형태
  const after = msg.match(/^(\d{4,8})\s*(?:번|호)?\s*(?:주문|배송|언제|확인|조회)/);
  if (after) return after[1];
  return null;
}

// ───────────────────── 인사 판별 ─────────────────────

const GREETING_ONLY =
  /^(안녕하세요|안녕하십니까|안녕|하이|헬로|hello|hi|반갑습니다|감사합니다|고맙습니다)[\s!~.。]*$/i;

/** 인사말만 있는 짧은 메시지인지 — 이후 대화는 전부 문맥 응답 */
export function isGreetingOnly(message: string): boolean {
  const t = (message || "").trim();
  if (!t || t.length > 12) return false;
  return GREETING_ONLY.test(t);
}

// ───────────────────── 권한 경계 (미션 §23) ─────────────────────

export type EscalationReason =
  | "고객이 상담원을 명시적으로 요청"
  | "정책 예외·보상·할인 요청"
  | "환불·결제 분쟁"
  | "상품 불량·배송 사고 책임 판단"
  | "주문 변경 등 처리 권한 밖 요청"
  | "계정·개인정보 민감 요청"
  | "사기·남용 의심 또는 법률 판단"
  | "확인된 데이터 부족"
  | "고객 불만 반복";

const HUMAN_REQUEST = /(상담원|상담사|직원|사람|인간|operator|내점|전화로|통화)/;
const COMPENSATION = /(보상|할인|쿠폰|적립금|사은품|깜짝|특별히|봐주세요|양해금)/;
const REFUND_DISPUTE = /(환불|결제\s*취소|chargeback|지불\s*취소|돈이\s*안|이중\s*결제)/;
const LIABILITY = /(불량|파손|오염|破損|망가|고장|책임|누가\s*잘못|허위|가품)/;
const WRITE_OPS = /(취소해\s*줘|취소하고\s*싶|취소\s*요청|교환하고\s*싶|반품하고\s*싶|바꿔\s*줘|변경해\s*줘|주소를?\s*바꿔|바꿔주세요)/;
const ACCOUNT_PII = /(비밀번호|패스워드|회원\s*탈퇴|개인정보|본인\s*인증|명의|주민)/;
const FRAUD_LEGAL = /(사기|詐欺|고소|법적|변호사|경찰|소비자원|신고하)/;
const DISSATISFIED = /(모르네|모르냐|못\s*알아|똑같|반복|답변이\s*없|만족\s*안|불만|헛돌|무슨\s*소리)/;

export interface EscalationDecision {
  escalate: boolean;
  reason?: EscalationReason;
}

/**
 * 권한 경계 판별. orderSensitive가 true면(주문 컨텍스트에서의 쓰기성 요청)
 * 교환/반품/취소 요청도 상담원 승격 대상.
 */
export function classifyEscalation(message: string, hasOrderContext: boolean): EscalationDecision {
  const msg = (message || "").trim();
  if (!msg) return { escalate: false };

  if (HUMAN_REQUEST.test(msg)) return { escalate: true, reason: "고객이 상담원을 명시적으로 요청" };
  if (FRAUD_LEGAL.test(msg)) return { escalate: true, reason: "사기·남용 의심 또는 법률 판단" };
  if (ACCOUNT_PII.test(msg)) return { escalate: true, reason: "계정·개인정보 민감 요청" };
  if (COMPENSATION.test(msg)) return { escalate: true, reason: "정책 예외·보상·할인 요청" };
  if (REFUND_DISPUTE.test(msg)) return { escalate: true, reason: "환불·결제 분쟁" };
  if (LIABILITY.test(msg)) return { escalate: true, reason: "상품 불량·배송 사고 책임 판단" };
  if (WRITE_OPS.test(msg) && hasOrderContext) {
    return { escalate: true, reason: "주문 변경 등 처리 권한 밖 요청" };
  }
  // 주문 컨텍스트 없는 환불/취소 질문은 정책 설명은 가능 — 단 상담원 요청어가 없으면 통과
  return { escalate: false };
}

/** 고객의 연속 불만 감지 (2회 연속 시 상담원 승격 — 미션 §23.N) */
export function isDissatisfied(message: string): boolean {
  return DISSATISFIED.test(message || "");
}

// ───────────────── 주문 요약 · 프라이버시 (미션 §32–§34) ─────────────────

export interface SafeOrderView {
  orderId: string;
  itemLine: string; // "상품명 / 색상 / 사이즈 ×수량, ..."
  shipStatus: string;
  paymentStatus: string;
  carrier: string;
  trackingNo: string;
  orderTime: string;
  total: number;
}

interface RawOrderLike {
  orderId: string;
  orderTime: string;
  itemsJson: string;
  shipStatus: string;
  paymentStatus: string;
  carrier: string;
  trackingNo: string;
  total: number;
}

/** 주문행 → CS 안전 요약 (항목·상태 등 비민감 필드만) */
export function toSafeOrderView(order: RawOrderLike): SafeOrderView | null {
  let items: { name?: string; color?: string; size?: string; qty?: number }[] = [];
  try {
    const parsed = JSON.parse(order.itemsJson || "[]");
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return null; // 항목 데이터가 깨진 주문은 요약을 만들지 않는다
  }
  const itemLine = items
    .map((it) => `${it.name || "상품"}${it.color ? ` / ${it.color}` : ""}${it.size ? ` / ${it.size}` : ""}${it.qty ? ` ×${it.qty}` : ""}`)
    .join(", ");
  return {
    orderId: order.orderId,
    itemLine: itemLine || "항목 정보 없음",
    shipStatus: order.shipStatus || "-",
    paymentStatus: order.paymentStatus || "-",
    carrier: order.carrier || "",
    trackingNo: order.trackingNo || "",
    orderTime: order.orderTime,
    total: order.total,
  };
}

/** 고객용 주문 요약 문장 (미션 §31 — 확인했음을 먼저 알리고 맥락 제시) */
export function formatOrderSummary(view: SafeOrderView): string {
  const lines = [
    `주문번호 ${view.orderId} 확인했어요.`,
    "",
    `${view.itemLine}`,
    `현재 상태: ${view.shipStatus}`,
  ];
  if (view.carrier && view.trackingNo) {
    lines.push(`택배: ${view.carrier} / ${view.trackingNo}`);
  }
  lines.push("", "배송, 옵션, 취소 등 어떤 부분이 궁금하신가요?");
  return lines.join("\n");
}

/**
 * 본인확인: 주문 연락처 뒷자리 일치 여부.
 * 회원이 로그인 상태에서 자신의 이메일이 고객 레코드와 일치하면 verified로 간주(호출자 판단).
 */
export function verifyByPhoneLast4(orderPhone: string, last4: string): boolean {
  const digits = (orderPhone || "").replace(/[^\d]/g, "");
  const probe = (last4 || "").replace(/[^\d]/g, "");
  return digits.length >= 4 && probe.length === 4 && digits.endsWith(probe);
}

/** 주문 컨텍스트 표기 (Telegram 운영자용) — 고객 UI와 분리 */
export function formatTelegramOrderContext(view: SafeOrderView): string {
  return `주문 ${view.orderId} · ${view.itemLine}\n상태: ${view.shipStatus} / 결제: ${view.paymentStatus} / ${(view.total || 0).toLocaleString()}원`;
}

/** 전화번호 마스킹 (운영자 컨텍스트를 제외한 노출용) */
export function maskPhone(phone: string): string {
  const digits = (phone || "").replace(/[^\d]/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

// ───────────────── 정책 답변 (확정된 정책 텍스트만 — 미션 §22.G) ─────────────────

export const POLICY_SHIPPING = [
  "· 파스토 당일출고 — 오후 1시 이전 결제 시 당일 출고 (전국 택배, 평균 1~3일 소요)",
  "· 배송비: 기본 3,000원 — 5만원 이상 구매 시 무료배송",
  "· 제주 및 도서·산간 지역은 3,000원의 추가 배송비가 발생합니다.",
].join("\n");

export const POLICY_EXCHANGE = [
  "· 상품 수령 후 7일 이내 고객센터로 신청 가능",
  "· 사이즈/색상 교환 1회 무료 (재고 있을 시)",
  "· 왕복 배송비 6,000원 고객 부담 (단순 변심 기준)",
  "· 택 제거·착용 흔적·세탁·향수 냄새가 있으면 교환이 불가합니다",
].join("\n");

export const POLICY_RETURN = [
  "· 상품 수령 후 7일 이내 신청 가능",
  "· 단순 변심 반품 편도 배송비 3,000원 고객 부담",
  "· 교환/반품 불가: 택 제거·착용 흔적·세탁/향수 냄새 등 상품 가치 훼손 시, 모니터 색상 차이, 시간 경과 개봉 상품",
  "· 표기·광고 내용과 상이한 상품은 전자상거래법에 따라 청약철회 가능합니다",
].join("\n");
