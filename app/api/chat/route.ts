/**
 * [CS 챗봇 응답 API] 고객 메시지 → hybrid_cs_router 로직으로 즉시 답변
 * POST /api/chat  { sid?, message, customer? } → { reply, escalated, sid }
 * + 봇3(CS상담센터) 텔레그램 실시간 미러링
 * + 세션은 Vercel 인메모리(전역) 저장
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __csStore: { sessions: Record<string, any>; counter: number } | undefined;
  // eslint-disable-next-line no-var
  var __csRouterLoaded: boolean;
}

const ESCALATION_KW = ["상담원", "사람", "통화", "전화", "환불", "파손", "불량", "항의"];

// hybrid_cs_router.py와 동일 로직 (Vercel 서버리스에서 python 호출 불가 → TS 포팅)
const PRODUCTS: Record<string, { name: string; sizeChart: string; modelInfo: string; material: string; washing: string; fit: string }> = {
  // 실측/소재 요약 (CS 응답용 핵심만 — 전체는 시트 참조)
  "블루종": { name: "남성용 포멀 경량 바람막이 블루종 카라 자켓", sizeChart: "L: 총장69/어깨48/가슴단면57/소매60 · XL: 총장71/어깨49/가슴단면59/소매61 · 2XL: 총장73/어깨50/가슴단면61/소매61", modelInfo: "", material: "폴리에스터 100%", washing: "드라이 클리닝", fit: "오버핏" },
  "가디건": { name: "남성 더블 집업 가디건 간절기용 클래식 니트", sizeChart: "S: 총장66/가슴단면48/어깨42/소매60 · M: 총장68/가슴단면50/어깨43/소매61 · L: 총장70/가슴단면52/어깨44/소매62", modelInfo: "", material: "폴리에스터, 아크릴", washing: "드라이 클리닝 권장", fit: "" },
  "니트 가디건": { name: "가을 니트 래빗 꽈배기 가디건 네이비", sizeChart: "프리사이즈: 길이48/가슴단면40/어깨34/소매55", modelInfo: "", material: "폴리에스터, 아크릴", washing: "찬물 손세탁", fit: "루즈핏" },
  "블라우스": { name: "여자 실크 새틴 블라우스 베이지", sizeChart: "F: 어깨37/가슴49/밑단49/소매장57/총길이62", modelInfo: "164cm F 착용", material: "폴리에스터 100%", washing: "드라이 클리닝 권장", fit: "" },
  "슬랙스": { name: "여자 봄 가을 밴딩 와이드 슬랙스", sizeChart: "M(25): 다리둘레59/엉덩이100/총장98 · L(26-27): 61/104/99 · XL(27-28): 62/108/100 · 2XL(28-29): 63/112/101", modelInfo: "", material: "폴리에스터", washing: "단독 세탁 · 이염 주의", fit: "" },
};

function findProduct(msg: string) {
  let best: { key: string; score: number } | null = null;
  for (const key of Object.keys(PRODUCTS)) {
    const tokens = key.split(" ");
    let score = 0;
    for (const t of tokens) if (msg.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }
  return best ? PRODUCTS[best.key] : null;
}

function answerLogic(message: string): { reply: string; escalated: boolean } {
  const msg = (message || "").trim();

  // 에스컬레이션
  if (ESCALATION_KW.some((k) => msg.includes(k))) {
    return {
      reply: "전문 상담원에게 연결되었습니다. 잠시만 기다려주시면 신속히 답변드리겠습니다.",
      escalated: true,
    };
  }

  // 주문/배송
  if (/주문|배송|송장|언제|조회/.test(msg)) {
    return { reply: "주문번호 또는 휴대폰 뒷자리를 알려주시면 배송 상태를 바로 조회해드립니다.\n\n· 주문 후 평균 1~3영업일 내 출고되며, 출고 시 송장번호와 배송조회 링크를 안내드립니다.", escalated: false };
  }

  // 사이즈/스펙
  if (/사이즈|치수|실측|핏|크기|오버|슬림|키|몸무게/.test(msg)) {
    const p = findProduct(msg);
    if (p) {
      let reply = `『${p.name}』 사이즈 정보입니다.\n\n[실측 사이즈]\n${p.sizeChart}\n`;
      if (p.modelInfo) reply += `\n[모델 착용] ${p.modelInfo}\n`;
      if (p.fit) reply += `\n[핏] ${p.fit}\n`;
      reply += "\n· 실측은 단면 기준(cm)이며 1~3cm 오차가 있을 수 있습니다.";
      return { reply, escalated: false };
    }
    return { reply: "어떤 상품의 사이즈가 궁금하신가요? 상품명을 함께 알려주시면 실측 치수와 모델 착용 정보를 안내드립니다.", escalated: false };
  }

  // 세탁/소재
  if (/세탁|소재|빨래|드라이|혼용률|안감|비침|두께/.test(msg)) {
    const p = findProduct(msg);
    if (p) {
      const parts = [`[소재] ${p.material}`, `[세탁/취급] ${p.washing}`].filter(Boolean);
      return { reply: `『${p.name}』 소재 정보입니다.\n\n${parts.join("\n")}`, escalated: false };
    }
    return { reply: "어떤 상품의 소재/세탁이 궁금하신가요? 상품명을 함께 알려주시면 바로 안내드립니다.", escalated: false };
  }

  // 기본 안내
  return {
    reply: "N°1 고객센터입니다. 아래 문의를 바로 답변드릴 수 있습니다.\n1. 주문/배송 조회 — 주문번호 또는 휴대폰 뒷자리\n2. 사이즈/핏 문의 — 상품명 + '사이즈'\n3. 소재/세탁 문의 — 상품명 + '세탁'\n상담원 연결이 필요하면 '상담원'이라고 입력해 주세요.",
    escalated: false,
  };
}

async function mirrorToBot3(message: string, reply: string, sid: string) {
  const token = process.env.N1_CS_BOT_TOKEN;
  const chat = process.env.N1_CS_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: `💬 [웹챗 미러링] ${sid}\n\n• 고객: ${message.slice(0, 100)}\n• 봇 답변: ${reply.slice(0, 100)}`,
      }),
    });
  } catch {}
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sid, message, customer } = body || {};
    if (!message?.trim()) return NextResponse.json({ ok: false, error: "메시지 누락" }, { status: 400 });

    // 세션 확보 (인메모리)
    if (!global.__csStore) global.__csStore = { sessions: {}, counter: 100 };
    const store = global.__csStore;
    let sessionId = sid;
    if (!sessionId || !store.sessions[sessionId]) {
      store.counter += 1;
      sessionId = `#SESS_${store.counter}`;
      store.sessions[sessionId] = { customer: customer || { name: "웹방문자" }, messages: [], status: "bot", created_at: new Date().toISOString() };
    }
    store.sessions[sessionId].messages.push({ role: "customer", text: message.trim(), ts: new Date().toISOString() });

    // 답변 생성
    const result = answerLogic(message);
    if (!result.escalated) {
      store.sessions[sessionId].messages.push({ role: "bot", text: result.reply, ts: new Date().toISOString() });
    } else {
      store.sessions[sessionId].status = "waiting_human";
      store.sessions[sessionId].escalated = true;
    }

    // 봇3 미러링 (비동기, 응답 지연 없음)
    mirrorToBot3(message.slice(0, 80), result.reply.slice(0, 80), sessionId).catch(() => {});

    return NextResponse.json({
      ok: true,
      sid: sessionId,
      reply: result.reply,
      escalated: result.escalated,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
