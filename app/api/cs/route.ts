/**
 * [CS 위젯 API] 웹챗 세션 생성 / 메시지 폴링
 * POST /api/cs          — 세션 생성 또는 고객 메시지 추가 (에스컬레이션 판별)
 * GET  /api/cs?sid=...  — 상담원 답변 폴링 (미전달 메시지 반환)
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// ⚠️ Vercel은 읽기전용 FS → 세션 저장을 인메모리로 대체 (서버리스 재시작 시 초기화됨)
// 실전 운영: Upstash Redis / Vercel KV로 교체 권장. 현재는 세션 수명이 요청 범위 내인 테스트용.
declare global {
  // eslint-disable-next-line no-var
  var __csStore: { sessions: Record<string, any>; counter: number } | undefined;
}
const STORE_FALLBACK = () => {
  if (!global.__csStore) global.__csStore = { sessions: {}, counter: 100 };
  return global.__csStore;
};

const ESCALATION_KW = ["상담원", "사람", "통화", "전화", "환불", "파손", "불량", "항의", "직접"];

function readStore() {
  return STORE_FALLBACK();
}
function writeStore(data: any) {
  global.__csStore = data; // 인메모리 (Vercel FS 읽기전용)
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // 클라이언트가 encodeURIComponent로 전송 → 복원 (ASCII 전송으로 mojibake 원천 차단)
    if (body.message) body.message = decodeURIComponent(body.message);
    const { sid, customer, message } = body || {};
    if (!message?.trim()) return NextResponse.json({ ok: false, error: "메시지 누락" }, { status: 400 });

    const store = readStore();
    let sessionId = sid;

    // 세션 생성 (신규)
    if (!sessionId || !store.sessions[sessionId]) {
      store.counter += 1;
      sessionId = `#SESS_${store.counter}`;
      store.sessions[sessionId] = {
        customer: customer || { name: "웹방문자", phone: "" },
        messages: [],
        status: "bot",
        escalated: false,
        created_at: new Date().toISOString(),
        web_ref: `MOCK_SESS_${store.counter - 100}`,
      };
    }
    const sess = store.sessions[sessionId];
    sess.messages.push({ role: "customer", text: message.trim(), ts: new Date().toISOString() });

    // 에스컬레이션 판별
    // NFC 정규화 + 키워드 매칭 (mojibake 대비: 키워드도 정규화 비교)
    const normalized = message.normalize("NFC");
    const needsHuman = ESCALATION_KW.some((k) => normalized.includes(k.normalize("NFC")));
    console.log("[cs] message:", message.slice(0, 30), "| needsHuman:", needsHuman);
    let escalated = false;
    if (needsHuman && !sess.escalated) {
      sess.escalated = true;
      sess.status = "waiting_human";
      escalated = true;
      // → 텔레그램 푸시는 별도 스크립트(order_notify)가 cs_sessions.json 감지하여 발송
    }
    writeStore(store);

    return NextResponse.json({
      ok: true,
      sid: sessionId,
      escalated,
      bot_reply: escalated
        ? "전문 상담원에게 연결되었습니다. 잠시만 기다려주시면 신속히 답변드리겠습니다."
        : undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("sid");
  if (!sid) return NextResponse.json({ ok: false, error: "sid 누락" }, { status: 400 });
  const store = readStore();
  const sess = store.sessions?.[sid];
  if (!sess) return NextResponse.json({ ok: false, error: "세션 없음" }, { status: 404 });
  const undelivered = sess.messages.filter((m: any) => m.role === "agent" && !m.delivered);
  // 전달 완료 마킹
  if (undelivered.length) {
    sess.messages.forEach((m: any) => { if (m.role === "agent") m.delivered = true; });
    sess.status = "closed";
    writeStore(store);
  }
  return NextResponse.json({
    ok: true,
    sid,
    status: sess.status,
    agent_messages: undelivered.map((m: any) => m.text),
  });
}
