#!/usr/bin/env node
/* CS 회귀 시나리오 (§77) — live /api/chat 검증. 출력만 담당. */
const BASE = "http://127.0.0.1:3211/api/chat";

async function send(sid, message) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sid, message }),
  });
  return res.json();
}

(async () => {
  let r = await send(undefined, "안녕하세요");
  console.log("[1 welcome]", r.status, "|", (r.reply || "").slice(0, 60).replace(/\n/g, " / "));
  const sid = r.sid;
  r = await send(sid, "날씨가 좋아요");
  console.log("[2 weather]", r.status, "|", (r.reply || "").slice(0, 60));
  r = await send(sid, "블랙 셔츠 소재가 뭐예요?");
  console.log("[3 material]", r.status, "|", (r.reply || "").slice(0, 90));
  r = await send(sid, "주문번호 1234 배송 언제 돼요?");
  console.log("[4 order]", r.status, "|", (r.reply || "").slice(0, 90));
  r = await send(sid, "상담원 연결해주세요");
  console.log("[5 escalate]", r.status, "escalated:", r.escalated, "|", (r.reply || "").slice(0, 60));
  r = await send(sid, "환불하고 싶어요");
  console.log("[6 human-active]", r.status, "|", (r.reply || "").slice(0, 60));
})();
