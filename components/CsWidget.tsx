"use client";

/**
 * [CS 위젯] n1pieces.com 우측 하단 채팅창
 * - 고객 메시지 → /api/cs POST (에스컬레이션 판별)
 * - 상담원 답변 → /api/cs GET 폴링 (3초 간격)
 */
import { useState, useRef, useEffect } from "react";
import { ChatIcon } from "./Icons";

interface Msg { role: "customer" | "agent" | "bot"; text: string; }

export default function CsWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sentGlow, setSentGlow] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // outside-dismiss: pointerdown→up 이동 거리 체크로 스와이프 오타 방지 (§16)
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const closePanel = () => {
    setOpen(false);
    fabRef.current?.focus(); // 닫히면 문의하기 트리거로 포커스 반환 (§20)
  };

  // ESC 닫기 (§12 CLOSE METHOD C)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // 재고 미확정 등에서 "고객센터 문의" 버튼이 이 위젯을 여는 경로 (자동 메시지 없음)
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("n1:open-cs", open);
    return () => window.removeEventListener("n1:open-cs", open);
  }, []);

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
    setSentGlow(true); // 전송 액션의 짧은 유리 afterglow (마이크로 인터랙션 전용)
    setTimeout(() => setSentGlow(false), 500);
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
          ref={fabRef}
          className="cs-fab"
          onClick={() => setOpen(true)}
          aria-label="고객센터 채팅"
        >
          <ChatIcon size={14} />
        </button>
      )}

      {/* outside-dismiss — 투명한 interaction layer (어두운 backdrop 아님, §14).
          실제 탭 intent(click)만 닫힘: pointerdown→up 이동이 크면 스와이프로 보고 유지(§16). */}
      {open && (
        <div
          className="cs-outside"
          aria-hidden="true"
          onPointerDown={(e) => { pressStart.current = { x: e.clientX, y: e.clientY }; }}
          onClick={(e) => {
            const s = pressStart.current;
            const moved = s ? Math.hypot(e.clientX - s.x, e.clientY - s.y) : 0;
            if (moved < 8) closePanel();
            pressStart.current = null;
          }}
        />
      )}

      {/* 채팅창 */}
      {open && (
        <div className="cs-window" role="dialog" aria-label="N°1 고객센터">
          <div className="cs-header">
            <span>N°1 고객센터</span>
            <button className="cs-close" onClick={closePanel} aria-label="고객센터 닫기">✕</button>
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
            <button className={`cs-send ${sentGlow ? "sent" : ""}`} onClick={send} disabled={!input.trim()}>전송</button>
          </div>
        </div>
      )}
    </>
  );
}
