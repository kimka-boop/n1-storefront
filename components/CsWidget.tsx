"use client";

/**
 * [CS 위젯] n1pieces.com 우측 하단 채팅창
 * - 고객 메시지 → /api/cs POST (에스컬레이션 판별)
 * - 상담원 답변 → /api/cs GET 폴링 (3초 간격)
 */
import { useState, useRef, useEffect } from "react";

interface Msg { role: "customer" | "agent" | "bot"; text: string; }

export default function CsWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sid, setSid] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // 상담원 답변 폴링 (세션 있을 때만, 3초)
  useEffect(() => {
    if (!sid) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/cs?sid=${encodeURIComponent(sid)}`, { cache: "no-store" });
        const data = await res.json();
        if (data.ok && data.agent_messages?.length) {
          setMsgs((prev) => [...prev, ...data.agent_messages.map((t: string) => ({ role: "agent" as const, text: t }))]);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [sid]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMsgs((prev) => [...prev, { role: "customer", text }]);
    setTyping(true);
    try {
      // 실시간 챗봇 응답 (/api/chat)
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid, message: encodeURIComponent(text), customer: { name: "web" } }),
      });
      const data = await res.json();
      if (data.ok) {
        setSid(data.sid);
        setMsgs((prev) => [...prev, { role: data.escalated ? "bot" : "bot", text: data.reply }]);
        if (data.escalated) {
          // 에스컬레이션 → 기존 세션 스토어에도 기록 (상담원 답장 대기)
          fetch("/api/cs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sid: data.sid, message: encodeURIComponent(text), customer: { name: "web" } }),
          }).catch(() => {});
        }
      }
    } catch {
      setMsgs((prev) => [...prev, { role: "bot", text: "연결이 불안정합니다. 잠시 후 다시 시도해주세요." }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <>
      {/* 채팅 버튼 */}
      {!open && (
        <button
          className="cs-fab"
          onClick={() => setOpen(true)}
          aria-label="고객센터 채팅"
        >
          💬
        </button>
      )}

      {/* 채팅창 */}
      {open && (
        <div className="cs-window">
          <div className="cs-header">
            <span>N°1 고객센터</span>
            <button className="cs-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="cs-messages">
            {msgs.length === 0 && (
              <p className="cs-welcome">
                안녕하세요, N°1 고객센터입니다.<br />
                주문·배송·사이즈·소재 문의를 남겨주세요.
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`cs-msg ${m.role}`}>
                {m.role === "agent" && <span className="cs-agent-badge">상담원</span>}
                <p>{m.text}</p>
              </div>
            ))}
            {typing && <p className="cs-typing">상담사 입력중...</p>}
            <div ref={bottomRef} />
          </div>
          <div className="cs-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="메시지를 입력하세요"
            />
            <button onClick={send} disabled={!input.trim()}>전송</button>
          </div>
        </div>
      )}
    </>
  );
}
