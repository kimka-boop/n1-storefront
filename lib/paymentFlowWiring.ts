/**
 * N°1 Payment Flow Wiring — 플로우(lib/paymentFlow)의 실제 배선 (서버 전용)
 *
 * 라우트(app/api/orders·payments/*)가 공유하는 유일한 배선 지점. 시트 접근, 재고 차감,
 * HERMES 이벤트, 봇2(N1 결제발주센터) 알림을 paymentFlow 계약에 맞춰 꽂는다.
 * 시크릿은 env에서만 읽고 값은 밖으로 반환하지 않는다.
 */
import { getDoc, findOrderById } from "@/lib/sheets";
import {
  findPaymentsByOrderId,
  findPaymentByProviderPaymentId,
  createPaymentRecord,
  updatePaymentRecord,
  PaymentRecord,
} from "@/lib/paymentRecords";
import { decrementStagingStock } from "@/lib/stockCheckout";
import { GateLine } from "@/lib/stockGate";
import { emitHermesEvent, HermesOrderEvent } from "@/lib/hermesEvents";
import { sendTelegramMessage } from "@/lib/telegram";
import { PaymentProvider } from "@/lib/paymentProvider";
import { PaymentFlowDeps } from "@/lib/paymentFlow";

async function loadAllPrices(): Promise<Map<string, { price: number; name: string }>> {
  const doc = await getDoc();
  const productsSheet = doc.sheetsByIndex[0];
  const rows = await productsSheet.getRows();
  const map = new Map<string, { price: number; name: string }>();
  for (const r of rows) {
    const id = String(r.get("상품ID") || "").trim();
    if (!id) continue;
    map.set(id, {
      price: Number(String(r.get("판매가") || "0").replace(/[^\d]/g, "")) || 0,
      name: String(r.get("상품명") || id),
    });
  }
  return map;
}

/** 요청 스코프 deps — loadPrice는 요청당 1회 상품 로딩 후 캐시한다 */
export async function buildPaymentFlowDeps(provider: PaymentProvider): Promise<PaymentFlowDeps> {
  let priceCache: Map<string, { price: number; name: string }> | null = null;
  const loadPrice: PaymentFlowDeps["loadPrice"] = async (sku) => {
    if (!priceCache) priceCache = await loadAllPrices();
    return priceCache.get(sku) ?? null;
  };

  return {
    provider,
    loadOrder: async (orderId) => {
      const doc = await getDoc();
      return findOrderById(doc, orderId);
    },
    loadPrice,
    createPayment: async (input) => {
      const doc = await getDoc();
      return createPaymentRecord(doc, { ...input, confirmedAmount: null });
    },
    findPaymentsByOrder: async (orderId) => {
      const doc = await getDoc();
      return findPaymentsByOrderId(doc, orderId);
    },
    findPaymentByProviderPaymentId: async (providerPaymentId) => {
      const doc = await getDoc();
      return findPaymentByProviderPaymentId(doc, providerPaymentId);
    },
    updatePayment: async (paymentId, patch) => {
      const doc = await getDoc();
      return updatePaymentRecord(doc, paymentId, patch);
    },
    confirmOrderPaid: async (orderId, info) => {
      const doc = await getDoc();
      const sheet = doc.sheetsByTitle["Orders"];
      if (!sheet) return { transitioned: false, alreadyPaid: false };
      const rows = await sheet.getRows();
      const row = rows.find((r) => String(r.get("주문번호")) === orderId);
      if (!row) return { transitioned: false, alreadyPaid: false };
      const current = String(row.get("결제상태") || "");
      if (current.includes("완료")) return { transitioned: false, alreadyPaid: true };
      row.set("결제상태", "결제완료");
      row.set("PG거래ID", info.providerPaymentId);
      const prevMemo = String(row.get("CS메모") || "").trim();
      const entry = `[${new Date().toISOString().slice(0, 16)}] PG결제확정 ${info.paymentId}`;
      row.set("CS메모", prevMemo ? `${prevMemo}\n${entry}` : entry);
      await row.save();
      return { transitioned: true, alreadyPaid: false };
    },
    decrementStock: async (lines: GateLine[], orderId) => {
      await decrementStagingStock(lines, orderId);
    },
    emitEvent: (e: HermesOrderEvent) => emitHermesEvent(() => getDoc(), e),
    notifyPaymentConfirmed: async (info) => {
      const r = await sendTelegramMessage(
        process.env.N1_PAYMENT_BOT_TOKEN || "",
        process.env.N1_PAYMENT_CHAT_ID || "",
        `✅ N°1 결제 완료 (${info.provider})\n\n주문번호: ${info.orderId}\n상품: ${info.itemsDesc}\n금액: ${info.amount.toLocaleString()}원\nPG거래ID: ${info.providerPaymentId}\n→ 발주 진행해주세요`,
      );
      if (!r.ok) console.warn("[paymentFlowWiring] 결제완료 봇2 알림 미발송");
    },
  };
}

export type { PaymentRecord };
