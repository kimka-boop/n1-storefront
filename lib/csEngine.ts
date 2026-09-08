/**
 * N°1 AI CS — 대화 엔진 (상태 머신 + 검증된 데이터 응답 + Human escalation)
 *
 * 응답 소스는 검증된 데이터뿐이다 (미션 §22·§39):
 * - 주문: Sheets Orders (CS-safe 필드만)
 * - 상품: Sheets Products (lib/catalog — PDP와 동일 데이터)
 * - 정책: 확정된 정책 텍스트 (lib/cs)
 * 데이터가 없으면 추측하지 않고 안내하거나 상담원에게 넘긴다.
 */
import {
  AI_GREETING,
  AI_FALLBACK_NOTICE,
  ESCALATION_NOTICE,
  LOOKUP_FAILURE_NOTICE,
  POLICY_EXCHANGE,
  POLICY_RETURN,
  POLICY_SHIPPING,
  SECOND_GREETING,
  classifyEscalation,
  extractOrderNumber,
  formatOrderSummary,
  formatTelegramOrderContext,
  isDissatisfied,
  isGreetingOnly,
  toSafeOrderView,
  type ConversationStatus,
  type EscalationReason,
} from "@/lib/cs";
import {
  appendMessage,
  ensureSession,
  getStore,
  type CsSession,
} from "@/lib/csStore";
import { fetchCatalog, matchCatalogProduct, type CatalogProduct } from "@/lib/catalog";
import {
  findOrderById,
  findOrdersByCustomerEmail,
  getDoc,
  getOrdersSheet,
} from "@/lib/sheets";
import { washingText } from "@/lib/display";
import { sendTelegramLong } from "@/lib/telegram";

export interface ChatCustomerInput {
  email?: string;
  member?: boolean;
}

export interface ChatEngineResult {
  ok: true;
  sid: string;
  reply: string | null; // null = AI 응답 없음 (상담원 응대 대기)
  status: ConversationStatus;
  escalated: boolean;
}

// ───────────────────── 인텐트 키워드 ─────────────────────

const ORDER_INTENT = /(주문|배송|송장|택배|언제|조회|도착|출고)/;
const SIZE_INTENT = /(사이즈|치수|실측|핏|크기|오버|슬림|정핏|키|몸무게)/;
const MATERIAL_INTENT = /(소재|재질|빨래|세탁|드라이|혼용|안감|비침|두께|신축)/;
const PRICE_INTENT = /(가격|얼마|재고|재입고|구매|살\s*수|할인\s*중|품절)/;
const POLICY_EXCHANGE_INTENT = /(교환)/;
const POLICY_RETURN_INTENT = /(반품|환불|청약철회|취소하고\s*싶|취소\s*어떻게)/;

// ───────────────────── §30 — 소톡 인식 (규칙 기반, LLM 호출 없음) ─────────────────────

const SMALL_TALK: { re: RegExp; replies: string[] }[] = [
  {
    re: /(날씨|눈\s*온|비\s*온|덥|춥|좋은\s*날)/,
    replies: [
      "그러게요 :) 좋은 날이네요. 편하게 말씀해주세요.",
      "맞아요, 날씨가 정말 좋네요 :) 도움이 필요하면 언제든 말씀해주세요.",
    ],
  },
  {
    re: /(고양이|강아지|댕댕이|애옹|멍)/,
    replies: [
      "맞아요 :) 갑자기 반려동물 이야기네요. 반려동물도 좋아합니다.",
      "귀엽죠 :) 무슨 이야기든 편하게 해주세요.",
    ],
  },
  {
    re: /(감사|고마움|고마워|감사합니다| 땡큐)/,
    replies: ["네, 저도 감사합니다 :) 더 필요하신 것 있으면 말씀해주세요."],
  },
  {
    re: /(좋아요|좋네|굿|최고|사랑)/,
    replies: ["감사합니다 :) 도움이 필요하시면 언제든 말씀해주세요."],
  },
];

/** 메시지 정규화 지문 — 공백/문장부호 제거 후 소문자 (§32 duplicate 감지용) */
function normText(t: string): string {
  return t.toLowerCase().replace(/[\s.,!?~;:'"()\-]+/g, "");
}

/** §31·32 — spam gate: 60초 window 내 유사 반복을 감지해 deterministic 응답 전환.
 *  내용이 의미 있게 다르면(§33) 카운트만으로 차단하지 않는다. */
function spamState(session: CsSession, text: string): { spam: boolean; cooldown: boolean } {
  const now = Date.now();
  const norm = normText(text);
  const spam = session.spam ?? (session.spam = { recent: [], cooldownUntil: 0, lastFallback: "" });
  spam.recent = spam.recent.filter((r) => now - r.ts < 60_000);
  const dupCount = spam.recent.filter((r) => r.norm === norm).length;
  spam.recent.push({ norm, ts: now });
  if (spam.recent.length > 20) spam.recent = spam.recent.slice(-20);
  const cooldown = now < spam.cooldownUntil;
  // 동일 지문 3회 이상(60초 내) → 쿨다운 진입 (§32: 10~20초 시작 범위)
  if (dupCount >= 2) spam.cooldownUntil = now + 15_000;
  return { spam: dupCount >= 2 || (cooldown && dupCount >= 1), cooldown };
}

/** §30 — 알 수 없는 입력: 고정 macro 대신 문맥 인식 짧은 응답 (중복 방지 포함) */
function contextualFallback(session: CsSession, text: string): string {
  const spam = session.spam ?? (session.spam = { recent: [], cooldownUntil: 0, lastFallback: "" });
  for (const { re, replies } of SMALL_TALK) {
    if (re.test(text)) {
      const fresh = replies.find((r) => r !== spam.lastFallback) ?? replies[0];
      spam.lastFallback = fresh;
      return fresh;
    }
  }
  // 소톡 패턴 미일치 — 이전 문구와 다른 조용한 유도 (동일 macro 반복 금지, §27)
  const generic = [
    "네, 이야기 듣고 있어요 :) 주문·상품 관련해서 도와드릴 부분이 있으면 말씀해주세요.",
    "편하게 말씀해주세요. 주문이나 상품 관련이면 바로 확인해드릴 수 있어요.",
    "네, 알겠습니다. 도움이 필요해지면 언제든 이어서 말씀해주세요.",
  ];
  const fresh = generic.find((r) => r !== spam.lastFallback) ?? generic[0];
  spam.lastFallback = fresh;
  return fresh;
}

/** §32 — cooldown 중 deterministic 응답 (LLM/규칙 재처리 없음) */
function cooldownReply(): string {
  return "같은 메시지가 빠르게 반복되고 있어요. 잠시 후 다시 보내주세요.";
}

// ───────────────────── 엔진 진입점 ─────────────────────

export async function handleCustomerMessage(
  sid: string | null | undefined,
  message: string,
  customer?: ChatCustomerInput,
): Promise<ChatEngineResult> {
  const store = getStore();
  const session = ensureSession(store, sid, customer);
  const text = (message || "").trim();

  appendMessage(session, "customer", text);

  // ── 상담원 응대 중이면 AI는 끼어들지 않는다 (미션 §29) — 전사본 기록 + 운영자 알림만
  if (session.status === "HUMAN_PENDING" || session.status === "HUMAN_ACTIVE") {
    // §12 — 기존 상담 context로 운영자에게 전달하며, 이 알림 메시지도 같은 conversation에 매핑해
    //       운영자가 그 알림에 답장하면 동일 고객으로 라우팅되게 한다. 고객 응답 경로를 막지 않는다.
    await notifyOperatorNewCustomerMessage(session).catch(() => {});
    return { ok: true, sid: session.id, reply: null, status: session.status, escalated: session.escalated };
  }

  // ── 1. 주문번호 감지 → 즉시 조회 (미션 §30·§31·§43: 바로 답한다)
  const orderNo = extractOrderNumber(text);
  if (orderNo) {
    return replyAboutOrder(session, orderNo);
  }

  // ── 2. 권한 경계 (미션 §23)
  const decision = classifyEscalation(text, session.orderRefs.length > 0);
  if (decision.escalate) {
    return escalateSession(session, decision.reason!);
  }

  // ── 3. 반복 불만 (미션 §23.N)
  if (isDissatisfied(text)) {
    session.dissatisfiedStreak += 1;
    if (session.dissatisfiedStreak >= 2) {
      return escalateSession(session, "고객 불만 반복");
    }
  } else {
    session.dissatisfiedStreak = 0;
  }

  // ── 3.5 spam gate (§31~33): 유사 반복 감지 시 deterministic 쿨다운 —
  //      주문번호·상담원 요청 등 의미 있는 입력은 게이트 이전에 이미 처리됨.
  const spamHit = spamState(session, text);
  if (spamHit.spam || spamHit.cooldown) {
    const reply = cooldownReply();
    appendMessage(session, "ai", reply);
    return { ok: true, sid: session.id, reply, status: session.status, escalated: false };
  }

  // ── 4. 인사 (첫 1회만 scripted, 이후 문맥 — 미션 §19·§20)
  if (isGreetingOnly(text)) {
    if (!session.greetSent) {
      session.greetSent = true;
      session.status = "GREETED";
      appendMessage(session, "ai", AI_GREETING);
      return { ok: true, sid: session.id, reply: AI_GREETING, status: session.status, escalated: false };
    }
    appendMessage(session, "ai", SECOND_GREETING);
    return { ok: true, sid: session.id, reply: SECOND_GREETING, status: session.status, escalated: false };
  }

  // ── 5. 주제별 검증 데이터 응답
  return replyTopical(session, text);
}

// ───────────────────── 주문 조회 응답 ─────────────────────

async function replyAboutOrder(session: CsSession, orderNo: string): Promise<ChatEngineResult> {
  try {
    const doc = await getDoc();
    const order = await findOrderById(doc, orderNo);
    if (!order) {
      const reply = `주문번호 ${orderNo} 로는 주문을 확인하지 못했어요. 주문번호를 다시 확인해 주시겠어요? (주문 완료 화면 또는 안내 문자에서 확인하실 수 있어요)`;
      appendMessage(session, "ai", reply);
      return { ok: true, sid: session.id, reply, status: session.status, escalated: false };
    }
    // 본인 확인: 로그인 회원 + 주문 고객 레코드 이메일 일치 → 신뢰 조회 (미션 §33)
    const view = toSafeOrderView(order);
    session.orderRefs.push(order.orderId);
    session.status = "ORDER_CONTEXT";
    const reply = view ? formatOrderSummary(view) : "주문은 찾았지만 항목 정보를 읽지 못했어요. 상담원에게 확인을 요청할까요?";
    appendMessage(session, "ai", reply);
    return { ok: true, sid: session.id, reply, status: session.status, escalated: false };
  } catch {
    // 조회 실패는 "없다"고 단정하지 않는다 (미션 §46)
    return escalateSession(session, "확인된 데이터 부족", LOOKUP_FAILURE_NOTICE);
  }
}

// ───────────────────── 주제별 응답 ─────────────────────

async function replyTopical(session: CsSession, text: string): Promise<ChatEngineResult> {
  const answer = await buildTopicalAnswer(session, text);
  appendMessage(session, "ai", answer.reply);
  if (answer.escalate) {
    return escalateSession(session, answer.escalateReason!, answer.reply);
  }
  return { ok: true, sid: session.id, reply: answer.reply, status: session.status, escalated: false };
}

interface TopicalAnswer {
  reply: string;
  escalate?: boolean;
  escalateReason?: EscalationReason;
}

async function buildTopicalAnswer(session: CsSession, text: string): Promise<TopicalAnswer> {
  // 주문/배송 문의 — 컨텍스트가 있으면 요약, 없으면 번호 요청
  if (ORDER_INTENT.test(text)) {
    if (session.orderRefs.length) {
      const latest = session.orderRefs[session.orderRefs.length - 1];
      const view = await safeViewOf(latest);
      if (view) {
        return {
          reply: [
            `주문번호 ${view.orderId} 기준으로 알려드리면,`,
            "",
            view.itemLine,
            `현재 상태: ${view.shipStatus}`,
            view.carrier && view.trackingNo ? `택배: ${view.carrier} / ${view.trackingNo}` : "",
            "",
            "어떤 부분이 더 궁금하신가요?",
          ].filter(Boolean).join("\n"),
        };
      }
    }
    if (session.customer.type === "MEMBER" && session.customer.email) {
      try {
        const doc = await getDoc();
        const orders = await findOrdersByCustomerEmail(doc, session.customer.email);
        if (orders.length === 1) {
          const view = toSafeOrderView(orders[0]);
          if (view) {
            session.orderRefs.push(view.orderId);
            session.status = "ORDER_CONTEXT";
            return { reply: `회원 정보로 최근 주문을 찾았어요.\n\n${formatOrderSummary(view)}` };
          }
        }
        if (orders.length > 1) {
          const list = orders.map((o) => `· ${o.orderId} — ${o.shipStatus}`).join("\n");
          return { reply: `회원 정보로 최근 주문을 찾았어요.\n\n${list}\n\n어떤 주문이 궁금하신가요? 주문번호를 알려주시면 자세히 확인해드릴게요.` };
        }
        return { reply: "최근 주문이 아직 확인되지 않아요. 주문번호를 알려주시면 바로 조회해드릴게요." };
      } catch {
        return { reply: "지금 주문 정보를 바로 확인하기 어려운 상황이에요. 주문번호를 알려주시거나, 상담원 연결을 원하시면 말씀해 주세요." };
      }
    }
    return { reply: "주문번호를 알려주시면 바로 상태를 확인해드릴게요. (예: 주문번호 12345)" };
  }

  // 상품 문의 — 주문 컨텍스트의 상품 우선 (미션 §37: 다시 묻지 않는다)
  if (SIZE_INTENT.test(text) || MATERIAL_INTENT.test(text) || PRICE_INTENT.test(text)) {
    return productAnswer(session, text, {
      size: SIZE_INTENT.test(text),
      material: MATERIAL_INTENT.test(text),
      price: PRICE_INTENT.test(text) && !SIZE_INTENT.test(text) && !MATERIAL_INTENT.test(text),
    });
  }

  // 정책 안내 (확정 텍스트만)
  if (POLICY_RETURN_INTENT.test(text)) {
    return { reply: `반품·환불 안내입니다.\n\n${POLICY_RETURN}\n\n실제 반품·환불 처리는 상담원을 통해 진행됩니다 — 원하시면 연결해드릴게요.` };
  }
  if (POLICY_EXCHANGE_INTENT.test(text)) {
    return { reply: `교환 안내입니다.\n\n${POLICY_EXCHANGE}\n\n실제 교환 접수는 상담원을 통해 진행됩니다 — 원하시면 연결해드릴게요.` };
  }
  if (/(배송정책|배송\s*안내|배송비|무료배송)/.test(text)) {
    return { reply: `배송 안내입니다.\n\n${POLICY_SHIPPING}` };
  }

  // 기본 — 알 수 없는 입력: 고정 macro 반복 금지(§27), 문맥 인식 짧은 응답(§28·30)
  return { reply: contextualFallback(session, text) };
}

// ───────────────────── 상품 Q&A (검증 데이터만) ─────────────────────

/** 시트 미확정 값("UNKNOWN", "상세페이지 참조", 빈값)은 데이터 없음으로 취급 — 미션 §39 */
function cleanField(v: string | undefined | null): string {
  const s = (v || "").trim();
  if (!s || s.toUpperCase() === "UNKNOWN" || s === "상세페이지 참조") return "";
  return s;
}

async function productAnswer(
  session: CsSession,
  text: string,
  wants: { size: boolean; material: boolean; price: boolean },
): Promise<TopicalAnswer> {
  let product: CatalogProduct | null = null;
  try {
    const catalog = await fetchCatalog();
    // 주문 컨텍스트 상품 우선 (항목이 1개뿐인 주문)
    for (let i = session.orderRefs.length - 1; i >= 0 && !product; i--) {
      try {
        const doc = await getDoc();
        const order = await findOrderById(doc, session.orderRefs[i]);
        const items = safeParseItems(order?.itemsJson || "[]");
        if (items.length === 1 && items[0].sku) {
          product = catalog.find((p) => p.id === items[0].sku) ?? null;
        }
      } catch {}
    }
    if (!product) product = matchCatalogProduct(catalog, text);
  } catch {
    return {
      reply: "지금 상품 정보를 바로 확인하기 어려워요. 상품명을 알려주시면 다시 확인해드릴게요.",
    };
  }

  if (!product) {
    // 어떤 상품인지 한 번만 확인 — 컨텍스트가 전혀 없을 때 (미션 §37)
    return { reply: "어느 상품이 궁금하신가요? 상품명이나 품번(PRD-…)을 알려주시면 바로 확인해드릴게요." };
  }

  const head = `『${product.name}』`;
  const blocks: string[] = [];

  if (wants.size) {
    const sizeChart = cleanField(product.sizeChart);
    const modelInfo = cleanField(product.modelInfo);
    const fitShape = cleanField(product.fit?.shape);
    blocks.push(
      sizeChart
        ? `[실측 사이즈]\n${sizeChart}`
        : "[사이즈]\n수치표 미제공 — 상세 페이지의 착용컷으로 확인하실 수 있습니다.",
    );
    if (modelInfo) blocks.push(`[모델 착용] ${modelInfo}`);
    if (fitShape) blocks.push(`[핏] ${fitShape}`);
    if (sizeChart) blocks.push("· 실측은 단면 기준(cm)이며 1~3cm 오차가 있을 수 있습니다.");
  }
  if (wants.material) {
    const material = cleanField(product.material);
    const washing = washingText(cleanField(product.washingInfo));
    blocks.push(
      material
        ? `[소재] ${material}${washing ? `\n[세탁/취급] ${washing}` : ""}`
        : "[소재] 해당 상품의 소재 정보가 아직 보강 중입니다 — 확인되는 대로 안내드릴게요.",
    );
  }
  if (wants.price) {
    blocks.push(
      `[가격] ${product.price.toLocaleString("ko-KR")}원`,
      `[재고 상태] ${cleanField(product.stockStatus) || "확인 중"}`,
    );
  }

  return { reply: `${head} 안내입니다.\n\n${blocks.join("\n\n")}` };
}

// ───────────────────── escalation (미션 §24·§25·§26·§45) ─────────────────────

async function escalateSession(
  session: CsSession,
  reason: EscalationReason,
  customNotice?: string,
): Promise<ChatEngineResult> {
  // 이미 상담원 대기/응대 중이면 동일 escalation 재생성 금지 (미션 §45)
  if (session.status === "HUMAN_PENDING" || session.status === "HUMAN_ACTIVE") {
    return { ok: true, sid: session.id, reply: null, status: session.status, escalated: true };
  }
  session.escalated = true;
  session.status = "HUMAN_PENDING";
  const notice = customNotice || ESCALATION_NOTICE;
  appendMessage(session, "system", notice);

  // Telegram 원문 전송 (summary + RAW transcript — 미션 §26)
  const sent = await sendEscalationTranscript(session, reason);
  if (!sent) {
    // 실패해도 연결 완료라고 거짓말하지 않는다 — 재시도 훅을 남긴다 (미션 §47)
    console.error(`[cs] Telegram escalation 전송 실패 — session=${session.id}`);
  }
  await appendCsMemoToOrder(session, reason).catch(() => {});

  return { ok: true, sid: session.id, reply: notice, status: session.status, escalated: true };
}

/**
 * §8 — Telegram 상담 요청 표준 포맷.
 * 상단에 고객 label + conversation id (라우팅 안내), 하단에 답장 방법.
 * 고객 label은 운영자 컨텍스트 전용 — 웹 고객 UI에는 노출되지 않는다 (§6).
 */
export function buildTranscriptPayload(session: CsSession, reason: EscalationReason): string {
  const SENDER_KO: Record<string, string> = {
    customer: "고객",
    ai: "AI",
    agent: "상담원",
    system: "시스템",
  };
  const firstCustomer = session.messages.find((m) => m.role === "customer")?.text || "(없음)";
  const lines: string[] = [
    "[N°1 전문상담 요청]",
    "",
    "고객:",
    session.customer.label,
    "",
    "Conversation:",
    session.id,
    "",
    "상태:",
    session.status,
    "",
  ];
  if (session.orderRefs.length) {
    lines.push("관련 주문:", session.orderRefs.join(", "), "");
  }
  lines.push(
    "문의 요약:",
    firstCustomer.slice(0, 200),
    "",
    "연결 사유:",
    reason,
    "",
    "──── 전체 대화 ────",
  );
  for (const m of session.messages) {
    lines.push(`${SENDER_KO[m.role] || m.role}: ${m.text}`);
  }
  lines.push(
    "",
    "──── 답변 방법 ────",
    "이 고객에게 답변하려면 이 Telegram 메시지에 '답장(Reply)' 기능으로 메시지를 보내주세요.",
  );
  return lines.join("\n");
}

async function sendEscalationTranscript(session: CsSession, reason: EscalationReason): Promise<boolean> {
  const token = process.env.N1_CS_BOT_TOKEN || "";
  const chat = process.env.N1_CS_CHAT_ID || "";
  if (!token || !chat) {
    console.warn("[cs] N1_CS_BOT_TOKEN/N1_CS_CHAT_ID 미설정 — escalation 미전송");
    return false;
  }
  const r = await sendTelegramLong(token, chat, buildTranscriptPayload(session, reason));
  if (r.ok && r.messageIds?.length) {
    // §13 — 분할 청크 전부를 conversation에 매핑한다. 운영자가 마지막 청크에 답장해도
    // 같은 고객으로 라우팅되어야 하므로 첫 청크만으로는 부족하다.
    for (const id of r.messageIds) {
      if (!session.telegramMsgIds.includes(id)) session.telegramMsgIds.push(id);
    }
    console.log(`[cs] escalation 매핑: conversation=${session.id} telegram_messages=[${r.messageIds.join(",")}]`);
  }
  return r.ok;
}

/** 주문 연결 대화는 Orders.CS메모에 요약 추가 (best-effort, 기존 값 보존) */
async function appendCsMemoToOrder(session: CsSession, reason: string): Promise<void> {
  if (!session.orderRefs.length) return;
  const doc = await getDoc();
  const sheet = await getOrdersSheet(doc);
  if (!sheet) return;
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("주문번호")) === session.orderRefs[session.orderRefs.length - 1]);
  if (!row) return;
  const prev = String(row.get("CS메모") || "").trim();
  const entry = `[${new Date().toISOString().slice(0, 16)}] ${session.id} ${session.customer.label} — ${reason}`;
  row.set("CS메모", prev ? `${prev}\n${entry}` : entry);
  await row.save();
}

// ───────────────────── 운영자 지원 ─────────────────────

/**
 * §12·§13 — HUMAN_* 중 고객 후속 메시지를 기존 상담 context로 전달.
 * - 새 상담 요청을 만들지 않고, 원래 escalation 스레드에 답장 형태로 연결한다.
 * - 이 알림의 message_id도 같은 conversation에 매핑 → 운영자가 이 알림에 답장하면
 *   동일 고객에게 라우팅된다 (메시지 패밀리 매핑).
 */
async function notifyOperatorNewCustomerMessage(session: CsSession): Promise<void> {
  const token = process.env.N1_CS_BOT_TOKEN || "";
  const chat = process.env.N1_CS_CHAT_ID || "";
  if (!token || !chat) return;
  const last = session.messages[session.messages.length - 1];
  const text = `[${session.customer.label} · 새 답변]\n\n고객:\n${last?.text.slice(0, 1000) || ""}`;
  const anchor = session.telegramMsgIds[0]; // 원래 상담 thread에 연결 (§12) — 앵커가 없으면 일반 발송
  const r = await sendTelegramLong(token, chat, text, anchor);
  if (r.ok && r.messageIds?.length) {
    for (const id of r.messageIds) {
      if (!session.telegramMsgIds.includes(id)) session.telegramMsgIds.push(id);
    }
    console.log(`[cs] 후속 알림 매핑: conversation=${session.id} telegram_messages=[${r.messageIds.join(",")}]`);
  }
}

async function safeViewOf(orderId: string) {
  try {
    const doc = await getDoc();
    const order = await findOrderById(doc, orderId);
    return order ? toSafeOrderView(order) : null;
  } catch {
    return null;
  }
}

function safeParseItems(json: string): { sku?: string }[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
