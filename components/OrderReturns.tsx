"use client";

/**
 * [주문 조회 · 반품/교환 요청] Session I — Tasks 16·17
 *
 * 회원: Order History(GET /api/orders?token= — Session C) → 주문 선택 → 요청
 * 게스트: 주문번호+연락처 검증 조회(POST /api/orders/lookup — Session C) → 요청
 * 요청 플로우: 상품 → 반품/교환 → 사유 → 메모 → 제출 → 접수 상태
 *  (POST/GET /api/orders/return-request — Return_Requests 원장, Orders 무쓰기)
 *
 * 상태 판정·자격은 lib/orderState·lib/returnRequest(서버와 동일 모듈)로만 한다 —
 * 화면이 상태를 재해석하지 않는다. 게스트 연락처는 컴포넌트 상태에만 존재(저장소 미기록).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import {
  canRequestReturnExchange,
  requestEligibility,
  reasonsFor,
  NOTE_MAX,
  type RequestType,
  type ReturnRequestView,
} from "@/lib/returnRequest";
import type { OwnerOrderView } from "@/lib/orderView";
import styles from "./OrderReturns.module.css";

type Mode = "member" | "guest";
type Step = "product" | "type" | "reason" | "note";

interface RequestState {
  requests: ReturnRequestView[];
  orderLabel: string;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export default function OrderReturns() {
  const { token, email } = useAuth();
  const [mode, setMode] = useState<Mode>(token ? "member" : "guest");

  // 회원 주문내역
  const [orders, setOrders] = useState<OwnerOrderView[] | null>(null);
  const [memberError, setMemberError] = useState("");
  // [SESSION L · TASK 29] 조회 실패는 영구 정지가 아니라 재시도 가능한 상태다 —
  // memberError를 의존성에서 뺀 트릭 변수로 "다시 시도" 재조회를 건다 (무한 루프 없음)
  const [memberRetryTick, setMemberRetryTick] = useState(0);

  // 게스트 조회
  const [guestId, setGuestId] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState("");

  // 선택된 주문 + 요청 상태
  const [order, setOrder] = useState<OwnerOrderView | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);

  useEffect(() => {
    if (token && !orders) {
      void (async () => {
        try {
          const res = await fetch(`/api/orders?token=${encodeURIComponent(token)}`, { cache: "no-store" });
          const data = await res.json();
          if (data.ok) {
            setOrders(data.orders || []);
          } else if (res.status === 401) {
            // [SESSION L] 로그인 만료와 조회 실패는 다른 상태다 — 구분해서 안내한다
            setMemberError("로그인 상태가 만료되었어요 — 페이지를 새로고침한 뒤 다시 로그인해 주세요.");
          } else {
            setMemberError("주문 내역을 불러오지 못했어요 — 일시적인 문제일 수 있어요.");
          }
        } catch {
          setMemberError("주문 내역을 불러오지 못했어요 — 연결 상태를 확인해 주세요.");
        }
      })();
    }
    if (!token && mode === "member") setMode("guest");
  }, [token, orders, memberRetryTick, mode]);

  const loadRequestState = useCallback(async (orderId: string, auth: { token?: string; phone?: string }) => {
    try {
      const sp = new URLSearchParams({ order_id: orderId });
      if (auth.token) sp.set("token", auth.token);
      if (auth.phone) sp.set("phone", auth.phone);
      const res = await fetch(`/api/orders/return-request?${sp.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setRequestState({ requests: data.requests || [], orderLabel: data.order_status?.label || "" });
      }
    } catch {
      // 요청 상태 조회 실패는 조용히 둔다 — 주문 상세 자체는 여전히 유효
    }
  }, []);

  const selectOrder = useCallback(
    (o: OwnerOrderView) => {
      setOrder(o);
      setRequestState(null);
      const auth = mode === "member" && token ? { token } : { phone: guestPhone };
      void loadRequestState(o.order_id, auth);
    },
    [mode, token, guestPhone, loadRequestState],
  );

  const guestLookup = async () => {
    if (!guestId.trim() || !guestPhone.trim()) {
      setGuestError("주문번호와 연락처를 모두 입력해 주세요");
      return;
    }
    setGuestBusy(true);
    setGuestError("");
    try {
      const res = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: guestId.trim(), phone: guestPhone.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setOrder(data.order);
        setRequestState(null);
        void loadRequestState(data.order.order_id, { phone: guestPhone.trim() });
      } else {
        setGuestError(data.error || "주문번호와 연락처가 일치하는 주문을 찾을 수 없습니다");
      }
    } catch {
      setGuestError("조회에 실패했습니다 — 잠시 후 다시 시도해 주세요");
    } finally {
      setGuestBusy(false);
    }
  };

  const auth = useMemo(
    () => (mode === "member" && token ? { token } : { phone: guestPhone.trim() }),
    [mode, token, guestPhone],
  );

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <p className={styles.kicker}>Orders</p>
        <h1 className={styles.title}>주문 조회 · 반품/교환</h1>
        <p className={styles.sub}>
          회원은 주문 내역에서, 비회원은 주문번호와 연락처로 본인 주문을 확인한 뒤
          반품·교환을 요청할 수 있습니다.
        </p>
      </header>

      <div className={styles.seg} role="tablist" aria-label="조회 방법">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "member"}
          className={mode === "member" ? styles.segOn : undefined}
          onClick={() => { setMode("member"); setOrder(null); setRequestState(null); }}
        >
          회원 주문내역
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "guest"}
          className={mode === "guest" ? styles.segOn : undefined}
          onClick={() => { setMode("guest"); setOrder(null); setRequestState(null); }}
        >
          비회원 주문 조회
        </button>
      </div>

      {mode === "member" ? (
        !token ? (
          <p className={styles.empty}>
            로그인 후 이용할 수 있습니다 — 페이지 상단에서 로그인해 주세요.
          </p>
        ) : memberError ? (
          <p className={styles.empty}>
            {memberError}
            <br />
            <button
              type="button"
              className={styles.cta}
              onClick={() => { setMemberError(""); setMemberRetryTick((t) => t + 1); }}
            >
              다시 시도
            </button>
          </p>
        ) : orders === null ? (
          <p className={styles.empty}>주문 내역을 불러오는 중…</p>
        ) : orders.length === 0 ? (
          <p className={styles.empty}>주문 내역이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {orders.map((o) => (
              <li key={o.order_id}>
                <button type="button" className={styles.card} onClick={() => selectOrder(o)}>
                  <div className={styles.cardTop}>
                    <span className={styles.orderNo}>{o.order_id}</span>
                    <span className={styles.chip}>{o.status_label}</span>
                  </div>
                  <div className={styles.cardMid}>
                    {o.items.map((it, i) => (
                      <span key={i} className={styles.itemLine}>
                        {it.name} ({it.color}{it.size ? `/${it.size}` : ""}) ×{it.qty}
                      </span>
                    ))}
                  </div>
                  <div className={styles.cardBot}>
                    <span>{formatTime(o.order_time)}</span>
                    <span>₩{Number(o.total).toLocaleString()}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className={styles.guestForm}>
          <label className={styles.field}>
            <span>주문번호</span>
            <input
              value={guestId}
              onChange={(e) => setGuestId(e.target.value)}
              placeholder="ORD-YYYYMMDD-…"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span>주문 시 연락처</span>
            <input
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="01012345678"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
          <button type="button" className={styles.cta} onClick={guestLookup} disabled={guestBusy}>
            {guestBusy ? "조회 중…" : "주문 조회"}
          </button>
          {guestError ? <p className={styles.formError}>{guestError}</p> : null}
          <p className={styles.guestNote}>
            주문번호와 연락처가 모두 일치해야 조회됩니다. 응답은 존재 여부를 구분하지 않습니다.
          </p>
        </div>
      )}

      {order ? (
        <OrderDetail
          order={order}
          auth={auth}
          requestState={requestState}
          onRequestsChanged={(next) => setRequestState(next)}
          onBack={() => { setOrder(null); setRequestState(null); }}
        />
      ) : null}
    </div>
  );
}

// ── 주문 상세 + 반품/교환 요청 플로우 ──

function OrderDetail({
  order,
  auth,
  requestState,
  onRequestsChanged,
  onBack,
}: {
  order: OwnerOrderView;
  auth: { token?: string; phone?: string };
  requestState: RequestState | null;
  onRequestsChanged: (next: RequestState) => void;
  onBack: () => void;
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const eligibility = useMemo(() => requestEligibility(order.status), [order.status]);

  return (
    <section className={styles.detail} aria-label="주문 상세">
      <button type="button" className={styles.back} onClick={onBack}>
        ← 목록으로
      </button>
      <div className={styles.detailHead}>
        <h2 className={styles.orderNo}>{order.order_id}</h2>
        <span className={styles.chip}>{requestState?.orderLabel || order.status_label}</span>
      </div>
      <p className={styles.detailMeta}>
        {formatTime(order.order_time)} · 총 ₩{Number(order.total).toLocaleString()} ·{" "}
        {order.payment.method}({order.payment.status})
      </p>
      <ul className={styles.items}>
        {order.items.map((it, i) => (
          <li key={i} className={styles.itemRow}>
            <span className={styles.itemName}>{it.name}</span>
            <span className={styles.itemOpt}>
              {it.color}{it.size ? ` / ${it.size}` : ""} · {it.qty}개 · ₩
              {(it.unit_price * it.qty).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.shipRow}>
        배송: {order.shipping.status || "-"}
        {order.shipping.tracking_no ? ` · ${order.shipping.carrier} ${order.shipping.tracking_no}` : ""}
      </div>

      {eligibility.ok ? (
        !flowOpen ? (
          <button type="button" className={styles.cta} onClick={() => setFlowOpen(true)}>
            반품·교환 요청
          </button>
        ) : (
          <RequestFlow
            order={order}
            auth={auth}
            requestState={requestState}
            onRequestsChanged={onRequestsChanged}
            onClose={() => setFlowOpen(false)}
          />
        )
      ) : (
        <p className={styles.ineligible}>{eligibility.message}</p>
      )}

      <RequestStatusPanel requestState={requestState} />
    </section>
  );
}

// ── 요청 플로우: 상품 → 유형 → 사유 → 메모 → 제출 ──

interface Selection {
  key: string;
  sku: string;
  name: string;
  color: string;
  size: string;
  qty: number;
  max: number;
}

function RequestFlow({
  order,
  auth,
  requestState,
  onRequestsChanged,
  onClose,
}: {
  order: OwnerOrderView;
  auth: { token?: string; phone?: string };
  requestState: RequestState | null;
  onRequestsChanged: (next: RequestState) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("product");
  const [sel, setSel] = useState<Selection[]>(
    order.items.map((it) => ({
      key: `${it.sku}::${it.color}::${it.size}`,
      sku: it.sku,
      name: it.name,
      color: it.color,
      size: it.size,
      qty: 1,
      max: it.qty,
    })),
  );
  const [type, setType] = useState<RequestType>("return");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState<{ request_id: string; message: string } | null>(null);

  const chosen = sel.filter((s) => s.qty > 0);
  const reasons = reasonsFor(type);
  const stepIndex = { product: 0, type: 1, reason: 2, note: 3 } as const;

  const setQty = (key: string, qty: number) =>
    setSel((prev) => prev.map((s) => (s.key === key ? { ...s, qty: Math.max(0, Math.min(s.max, qty)) } : s)));

  const submit = async () => {
    setBusy(true);
    setSubmitError("");
    try {
      const body: Record<string, unknown> = {
        order_id: order.order_id,
        type,
        reason_code: reason,
        note,
        items: chosen.map((s) => ({ sku: s.sku, color: s.color, size: s.size, qty: s.qty })),
      };
      if (auth.token) body.token = auth.token;
      if (auth.phone) body.phone = auth.phone;

      const res = await fetch("/api/orders/return-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setDone({ request_id: data.request_id, message: data.message });
        // 접수 상태 최신화 (요청 목록 + 현재 주문 상태 라벨)
        try {
          const sp = new URLSearchParams({ order_id: order.order_id });
          if (auth.token) sp.set("token", auth.token);
          if (auth.phone) sp.set("phone", auth.phone);
          const r2 = await fetch(`/api/orders/return-request?${sp.toString()}`, { cache: "no-store" });
          const d2 = await r2.json();
          if (d2.ok) {
            onRequestsChanged({ requests: d2.requests || [], orderLabel: d2.order_status?.label || "" });
          }
        } catch {}
      } else {
        setSubmitError(data.error || "요청 접수에 실패했습니다");
      }
    } catch {
      setSubmitError("서버 연결 실패 — 잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={styles.flow}>
        <p className={styles.doneMark}>✓</p>
        <p className={styles.doneText}>{done.message}</p>
        <p className={styles.doneMeta}>요청번호 {done.request_id} · 상태: 접수됨</p>
        <p className={styles.doneMeta}>
          요청 상태는 아래에서 확인하실 수 있습니다. 승인·환불 처리는 확인 후 진행됩니다.
        </p>
        <button type="button" className={styles.ghost} onClick={onClose}>
          닫기
        </button>
      </div>
    );
  }

  return (
    <div className={styles.flow}>
      <div className={styles.flowHead}>
        <span className={styles.flowTitle}>반품·교환 요청</span>
        <div className={styles.steps} aria-hidden>
          {(["product", "type", "reason", "note"] as Step[]).map((s, i) => (
            <span key={s} className={i <= stepIndex[step] ? styles.stepOn : undefined} />
          ))}
        </div>
      </div>

      {step === "product" ? (
        <div>
          <p className={styles.stepLabel}>1 · 상품 선택 — 요청할 상품과 수량</p>
          <ul className={styles.pickers}>
            {sel.map((s) => (
              <li key={s.key} className={s.qty > 0 ? styles.pickerOn : undefined}>
                <label className={styles.pickerLine}>
                  <input
                    type="checkbox"
                    checked={s.qty > 0}
                    onChange={(e) => setQty(s.key, e.target.checked ? 1 : 0)}
                  />
                  <span className={styles.pickerName}>{s.name}</span>
                  <span className={styles.pickerOpt}>
                    {s.color}{s.size ? ` / ${s.size}` : ""}
                  </span>
                  <span className={styles.pickerQty}>
                    <button type="button" onClick={() => setQty(s.key, s.qty - 1)} aria-label="수량 줄이기">−</button>
                    <b>{s.qty}</b>
                    <button type="button" onClick={() => setQty(s.key, s.qty + 1)} aria-label="수량 늘리기">＋</button>
                    <i>/ {s.max}</i>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === "type" ? (
        <div>
          <p className={styles.stepLabel}>2 · 유형 — 교환 또는 반품</p>
          <div className={styles.typeSeg}>
            <button
              type="button"
              className={type === "return" ? styles.segOn : undefined}
              onClick={() => { setType("return"); setReason(""); }}
            >
              반품 (환불)
            </button>
            <button
              type="button"
              className={type === "exchange" ? styles.segOn : undefined}
              onClick={() => { setType("exchange"); setReason(""); }}
            >
              교환
            </button>
          </div>
          <p className={styles.stepHint}>
            교환은 재고가 있는 경우에만 가능하며, 단순 변심 시 왕복 배송비가 부담될 수 있습니다.
          </p>
        </div>
      ) : null}

      {step === "reason" ? (
        <div>
          <p className={styles.stepLabel}>3 · 사유</p>
          <ul className={styles.reasons}>
            {reasons.map((r) => (
              <li key={r.code}>
                <label className={reason === r.code ? styles.reasonOn : undefined}>
                  <input
                    type="radio"
                    name="n1-return-reason"
                    checked={reason === r.code}
                    onChange={() => setReason(r.code)}
                  />
                  {r.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === "note" ? (
        <div>
          <p className={styles.stepLabel}>4 · 메모 (선택)</p>
          <textarea
            className={styles.noteInput}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="전달할 내용을 적어주세요 (선택)"
            rows={4}
          />
          <p className={styles.stepHint}>{note.length}/{NOTE_MAX}자 · 제출하면 접수 후 상담원이 확인합니다.</p>
        </div>
      ) : null}

      {submitError ? <p className={styles.formError}>{submitError}</p> : null}

      <div className={styles.flowNav}>
        {step !== "product" ? (
          <button type="button" className={styles.ghost} onClick={() => setStep(
            step === "type" ? "product" : step === "reason" ? "type" : "reason",
          )}>
            이전
          </button>
        ) : (
          <button type="button" className={styles.ghost} onClick={onClose}>
            취소
          </button>
        )}
        {step !== "note" ? (
          <button
            type="button"
            className={styles.cta}
            disabled={step === "product" && chosen.length === 0}
            onClick={() => setStep(step === "product" ? "type" : step === "type" ? "reason" : "note")}
          >
            다음
          </button>
        ) : (
          <button
            type="button"
            className={styles.cta}
            disabled={busy || chosen.length === 0 || !reason}
            onClick={submit}
          >
            {busy ? "접수 중…" : "제출"}
          </button>
        )}
      </div>
      <p className={styles.requestStateHint}>
        {requestState && requestState.requests.length > 0
          ? `이 주문에 접수된 요청 ${requestState.requests.length}건이 있습니다 — 아래 목록 참고`
          : null}
      </p>
    </div>
  );
}

// ── 접수 상태 패널 (요청 목록 + 현재 주문 상태) ──

function RequestStatusPanel({ requestState }: { requestState: RequestState | null }) {
  if (!requestState) return null;
  return (
    <div className={styles.statusPanel}>
      <p className={styles.statusTitle}>요청 상태</p>
      {requestState.requests.length === 0 ? (
        <p className={styles.statusEmpty}>접수된 반품·교환 요청이 없습니다.</p>
      ) : (
        <ul className={styles.statusList}>
          {requestState.requests.map((r) => (
            <li key={r.request_id}>
              <div className={styles.statusTop}>
                <span className={styles.orderNo}>{r.request_id}</span>
                <span className={styles.chip}>{r.status || "접수됨"}</span>
              </div>
              <p className={styles.statusMeta}>
                {formatTime(r.requested_at)} · {r.type_label} · {r.reason}
                {r.channel ? ` · ${r.channel} 접수` : ""}
              </p>
              <p className={styles.statusItems}>
                {r.items.map((it, i) => (
                  <span key={i}>
                    {it.name} ({it.color}{it.size ? `/${it.size}` : ""}) ×{it.qty}
                    {i < r.items.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
              {r.note ? <p className={styles.statusNote}>메모: {r.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.statusHint}>
        현재 주문 상태: <b>{requestState.orderLabel || "-"}</b> — 승인·환불 진행은 주문 상태에 반영됩니다.
      </p>
      <p className={styles.statusCs}>
        진행 상황 문의는 고객센터(페이지 하단 좌측 말풍선 아이콘)로 문의해 주세요.
      </p>
    </div>
  );
}
