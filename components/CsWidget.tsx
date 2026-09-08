"use client";

/**
 * [CS 위젯] N°1 고객센터 채팅 (미션 §17–§46)
 * - 대화 상태 머신은 서버(lib/csEngine)가 담당 — 위젯은 전사 뷰어
 * - 새로고침 후에도 같은 대화 복원 (localStorage sid → GET /api/cs)
 * - 역할 구분 표시: AI 답변 / 전문 상담원 답변 / 시스템 안내 (미션 §42)
 * - 상담원 응대 중(HUMAN_*)엔 4초 폴링으로 답변 수신
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ChatIcon } from "./Icons";
import { useAuth } from "./AuthProvider";

interface Msg { role: "customer" | "ai" | "agent" | "system"; text: string; }

const SID_KEY = "n1_cs_sid";
const HUMAN_STATES = new Set(["HUMAN_PENDING", "HUMAN_ACTIVE"]);

export default function CsWidget() {
  const { token, email } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sentGlow, setSentGlow] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("NEW");
  const [typing, setTyping] = useState(false);
  const [restored, setRestored] = useState(false);
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
  }, [msgs, typing]);

  // 재고 미확정 등에서 "고객센터 문의" 버튼이 이 위젯을 여는 경로 (자동 메시지 없음)
  useEffect(() => {
    const openEv = () => setOpen(true);
    window.addEventListener("n1:open-cs", openEv);
    return () => window.removeEventListener("n1:open-cs", openEv);
  }, []);

  const applyTranscript = useCallback((serverMsgs: { role: string; text: string }[]) => {
    setMsgs(
      serverMsgs
        .filter((m): m is { role: Msg["role"]; text: string } =>
          m.role === "customer" || m.role === "ai" || m.role === "agent" || m.role === "system")
        .map((m) => ({ role: m.role, text: m.text })),
    );
  }, []);

  // 대화 복원 — 서버에 세션이 있으면 전사본으로 뷰 동기화 (미션 §38 기억)
  useEffect(() => {
    const saved = localStorage.getItem(SID_KEY);
    if (!saved) {
      setRestored(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/cs?sid=${encodeURIComponent(saved)}`, { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
          setSid(saved);
          setStatus(data.status);
          applyTranscript(data.messages || []);
        } else {
          localStorage.removeItem(SID_KEY); // 서버 세션 만료(재시작) — 새 대화로
        }
      } catch {}
      setRestored(true);
    })();
  }, [applyTranscript]);

  // 상담원 답변 폴링 — 상담원 관련 상태에서만 (AI 응답은 동기 응답)
  useEffect(() => {
    if (!sid || !HUMAN_STATES.has(status)) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/cs?sid=${encodeURIComponent(sid)}`, { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
          setStatus(data.status);
          applyTranscript(data.messages || []);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [sid, status, applyTranscript]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMsgs((prev) => [...prev, { role: "customer", text }]);
    setTyping(true);
    setSentGlow(true);
    setTimeout(() => setSentGlow(false), 500);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid,
          message: encodeURIComponent(text),
          customer: { name: "web", email: email || undefined, member: Boolean(token) },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSid(data.sid);
        setStatus(data.status);
        localStorage.setItem(SID_KEY, data.sid);
        if (data.escalated && data.status === "HUMAN_PENDING") {
          // 전사본을 다시 당겨와 system 안내까지 정확히 반영
          const r2 = await fetch(`/api/cs?sid=${encodeURIComponent(data.sid)}`, { cache: "no-store" });
          const d2 = await r2.json();
          if (d2.ok) applyTranscript(d2.messages || []);
        } else if (data.reply) {
          setMsgs((prev) => [...prev, { role: "ai", text: data.reply }]);
        }
        // reply === null → 상담원 응대 중: AI가 끼어들지 않는다 (미션 §29)
      } else {
        setMsgs((prev) => [...prev, { role: "system", text: "지금 자동 상담 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요." }]);
      }
    } catch {
      setMsgs((prev) => [...prev, { role: "system", text: "연결이 불안정합니다. 잠시 후 다시 시도해주세요." }]);
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
            {status === "HUMAN_ACTIVE" && <em className="cs-state">상담원 응대 중</em>}
            {status === "HUMAN_PENDING" && <em className="cs-state">상담원 연결 중</em>}
            <button className="cs-close" onClick={closePanel} aria-label="고객센터 닫기">✕</button>
          </div>
          <div className="cs-messages">
            {restored && msgs.length === 0 && (
              <p className="cs-welcome">
                안녕하세요, N°1 고객센터입니다.<br />
                주문·배송, 사이즈·핏, 소재·세탁 등<br />
                궁금한 내용을 편하게 남겨주세요.
              </p>
            )}
            {!restored && <p className="cs-typing">불러오는 중...</p>}
            {msgs.map((m, i) => (
              <div key={i} className={`cs-msg ${m.role}`}>
                {m.role === "agent" && <span className="cs-agent-badge">전문 상담원</span>}
                <p>{m.text}</p>
              </div>
            ))}
            {typing && <p className="cs-typing">입력 중...</p>}
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
