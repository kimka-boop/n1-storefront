/**
 * N°1 TELEGRAM OPS APPROVAL (미션 §42–§43)
 *
 * 오너 승인 요청 — 결제발주센터 봇(N1_PAYMENT_BOT)으로 compact 요청 카드 발송.
 * [승인] / [거절] / [확인 필요] inline 버튼(callback_query)으로 응답받는다.
 *
 * 경계:
 *  - [승인] = RETURN_APPROVED 까지다. 환불이 아니다 (§43).
 *  - callback은 결정론 매핑(callback_data에 request_id 포함) — "최근 채팅" 휴리스틱 금지 (§52).
 *  - 고객 전체 주소는 요청 카드에 넣지 않는다 (§42).
 *  - 콜백 처리기는 허용된 callback_data 접두사만 해석하고, 나머지는 조용히 무시한다.
 *    (Telegram 인바운드가 주문 상태를 함부로 바꾸지 않는다 — §53 검증 원칙)
 */
import { getTelegramUpdates, sendTelegramMessage } from "@/lib/telegram";
import { applyReturnTransition, stateFromLabel, RETURN_STATE_LABEL, type ReturnLifecycleState } from "@/lib/returnLifecycle";

const APPROVAL_PREFIX = "n1ret";

export type OpsDecision = "approve" | "reject" | "check";

export function approvalCallbackData(requestId: string, decision: OpsDecision): string {
  return `${APPROVAL_PREFIX}:${decision}:${requestId}`;
}

export function parseApprovalCallback(data: string): { decision: OpsDecision; requestId: string } | null {
  const parts = (data || "").split(":");
  if (parts.length !== 3 || parts[0] !== APPROVAL_PREFIX) return null;
  const decision = parts[1] as OpsDecision;
  if (!["approve", "reject", "check"].includes(decision)) return null;
  const requestId = parts[2].trim();
  if (!requestId.startsWith("RET-")) return null;
  return { decision, requestId };
}

/** inline keyboard를 붙인 전송 — 전용 fetch (공용 헬퍼는 reply_markup 미지원) */
async function sendApprovalCard(
  token: string,
  chatId: string,
  text: string,
  requestId: string,
): Promise<boolean> {
  const body = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          { text: "[승인]", callback_data: approvalCallbackData(requestId, "approve") },
          { text: "[거절]", callback_data: approvalCallbackData(requestId, "reject") },
          { text: "[확인 필요]", callback_data: approvalCallbackData(requestId, "check") },
        ],
      ],
    },
  };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ApprovalRequestInput {
  requestId: string;
  orderId: string;
  customerType: string;
  productDesc: string;
  amount: number;
  shipStatus: string;
  deliveredAt: string;
  requestedAt: string;
  customerReason: string;
  hermesVerdict: string;
}

/** §42 compact 승인 카드 — 주소 미포함 */
export function renderApprovalCard(i: ApprovalRequestInput): string {
  return [
    "[N°1 반품 승인 요청]",
    `주문: ${i.orderId}`,
    `회원/비회원: ${i.customerType}`,
    `상품: ${i.productDesc}`,
    `결제금액: ${i.amount.toLocaleString("ko-KR")}원`,
    `배송상태: ${i.shipStatus}`,
    i.deliveredAt ? `배송완료일: ${i.deliveredAt.slice(0, 10)}` : "",
    `반품 요청일: ${i.requestedAt.slice(0, 10)}`,
    `고객 사유: ${i.customerReason.slice(0, 120)}`,
    `HERMES 판정: ${i.hermesVerdict}`,
    `요청번호: ${i.requestId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function sendReturnApprovalRequest(input: ApprovalRequestInput): Promise<boolean> {
  const token = process.env.N1_PAYMENT_BOT_TOKEN || "";
  const chatId = process.env.N1_PAYMENT_CHAT_ID || "";
  if (!token || !chatId) return false; // 봇 미구성 — 승인 카드 없이 운영 시트 경로로 진행
  return sendApprovalCard(token, chatId, renderApprovalCard(input), input.requestId);
}

// ── callback_query 폴링 처리기 — ops 런타임(N1_SHIPPING_WATCHER_ENABLED)과 함께 구동 ──

let opsPollStarted = false;
let lastUpdateId = 0;

export function ensureOpsApprovalRuntime(openDoc: () => Promise<import("google-spreadsheet").GoogleSpreadsheet>): boolean {
  if (opsPollStarted) return true;
  const token = process.env.N1_PAYMENT_BOT_TOKEN || "";
  if (!token) return false;
  opsPollStarted = true;
  const poll = async () => {
    try {
      const res = await getTelegramUpdates(token, lastUpdateId ? lastUpdateId + 1 : 0, 0);
      if (res && res.updates) {
        for (const u of res.updates) {
          const uid = Number(u.update_id || 0);
          if (uid > lastUpdateId) lastUpdateId = uid;
          const cb = u.callback_query;
          if (!cb?.data) continue;
          const parsed = parseApprovalCallback(cb.data);
          if (!parsed) continue; // 미허용 콜백 — 조용히 무시 (검증 없는 변이 없음)
          const verdict = await handleOwnerDecision(openDoc, parsed.requestId, parsed.decision);
          if (cb.message?.message_id && chatOfToken(token)) {
            // 승인 결과를 같은 카드 스레드에 기록 (결정론: callback이 온 메시지에 회신)
            await sendTelegramMessage(token, chatOfToken(token) as string, verdict, cb.message.message_id);
          }
        }
      }
    } catch {
      // 폴링 실패 — 다음 틱에서 재시도
    }
  };
  setInterval(poll, 5_000).unref?.();
  console.log("[telegramOps] 승인 콜백 폴링 구동 (5s)");
  return true;
}

function chatOfToken(_token: string): string | null {
  return process.env.N1_PAYMENT_CHAT_ID || null;
}

/** 오너 결정 → 라이프사이클 전이 (결정 검증은 applyReturnTransition이 한다) */
export async function handleOwnerDecision(
  openDoc: () => Promise<import("google-spreadsheet").GoogleSpreadsheet>,
  requestId: string,
  decision: OpsDecision,
): Promise<string> {
  const doc = await openDoc();
  const sheet = doc.sheetsByTitle["Return_Requests"];
  let currentLabel = "";
  if (sheet) {
    const rows = await sheet.getRows();
    const row = rows.find((r) => String(r.get("request_id") || "") === requestId);
    currentLabel = String(row?.get("상태") || "");
  }
  const from = stateFromLabel(currentLabel);
  if (!from) return `처리 불가 — 요청 ${requestId} 상태 판독 실패`;

  let to: ReturnLifecycleState | null = null;
  if (decision === "approve") to = RETURN_APPROVED_TARGET(from);
  else if (decision === "reject") to = "RETURN_REJECTED";
  else if (decision === "check") to = "RETURN_REVIEW";

  if (!to) return `처리 불가 — ${from} 상태에서 거절할 수 없습니다`;
  if (decision === "approve" && to === "RETURN_APPROVED" && !["RETURN_REQUESTED", "RETURN_REVIEW"].includes(from)) {
    return `처리 불가 — 현재 ${RETURN_STATE_LABEL[from]} 상태입니다`;
  }
  const result = await applyReturnTransition(openDoc, requestId, to, { actor: "owner_telegram" });
  if (!result.ok) return `처리 불가 — ${result.error}`;
  if (result.externalFallback) {
    return `승인 기록 완료 → 공급사 반품 어댑터 미연결로 외부조치필요 전환 (수동 반품 접수 태스크 생성됨). 환불 아님.`;
  }
  return `기록 완료: ${RETURN_STATE_LABEL[from]} → ${RETURN_STATE_LABEL[to]}${decision === "approve" ? " (승인 — 환불 아님, §43)" : ""}`;
}

function RETURN_APPROVED_TARGET(from: ReturnLifecycleState): ReturnLifecycleState {
  return from === "RETURN_REQUESTED" || from === "RETURN_REVIEW" ? "RETURN_APPROVED" : from;
}
