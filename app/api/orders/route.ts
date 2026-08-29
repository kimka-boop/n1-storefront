/**
 * [모듈 2-2] 주문 웹훅 리시버
 * POST /api/orders — 표준 주문 JSON 수령 → 검증 → 분리배송 판별 → Orders 시트 인입 → 재고 차감
 *
 * 스키마 v1 (PG 전환 대응): payment 블록만 교체하면 토스페이먼츠 연동 가능
 * body: { customer: {name, phone, address, depositor}, items: [{sku, color, size, qty}] }
 * 응답: { ok, order_id, total_amount, shipping: {type, notice}, deposit_info }
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function loadSheetId(): string {
  if (process.env.N1_SHEET_ID) return process.env.N1_SHEET_ID;
  try {
    const envPath = path.join(process.cwd(), "..", ".env");
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      if (line.startsWith("N1_SHEET_ID=")) return line.split("=")[1].trim();
    }
  } catch {}
  return "";
}

async function getDoc() {
  let email: string, key: string;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else {
    const credPath = path.join(process.cwd(), "..", "credentials.json");
    const cred = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    email = cred.client_email;
    key = cred.private_key;
  }
  const auth = new JWT({
    email, key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
  const doc = new GoogleSpreadsheet(loadSheetId(), auth);
  await doc.loadInfo();
  return doc;
}

// ── 디렉터 텔레그램 알림 (신규 주문 인입) ──
async function notifyNewOrder(orderId: string, name: string, amount: number, shipType: string, itemsDesc: string) {
  const token = process.env.N1_TG_TOKEN;
  const chat = process.env.N1_TG_CHAT;
  const msg = `🛎️ N°1 신규 주문!\n\n주문번호: ${orderId}\n고객: ${name}\n상품: ${itemsDesc}\n금액: ${amount.toLocaleString()}원\n배송: ${shipType}\n→ 입금 확인 후 출고해주세요`;
  if (token && chat) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: msg }),
      });
    } catch {}
  }
}

export async function POST(req: Request) {
  try {
    // ⚠️ Vercel edge에서 한글 mojibake 방지: text → UTF-8 명시 파싱
const raw = await req.text();
const body = JSON.parse(raw);
    const { customer, items } = body || {};
    // ── 1. 입력 검증 ──
    if (!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "필수 항목 누락 (고객명/연락처/배송지/상품)" }, { status: 400 });
    }

    const doc = await getDoc();
    const productsSheet = doc.sheetsByIndex[0]; // Products
    const pRows = await productsSheet.getRows();

    // ── 2. 서버 측 가격 재계산 (클라이언트 금액 신뢰 금지) + 재고 확인 ──
    let total = 0;
    const resolved: { sku: string; color: string; size: string; qty: number; unit_price: number; supplier: string }[] = [];
    for (const it of items) {
      const p = pRows.find((r) => r.get("상품ID") === it.sku);
      if (!p) return NextResponse.json({ ok: false, error: `존재하지 않는 상품: ${it.sku}` }, { status: 400 });
      const price = Number(String(p.get("판매가") || "0").replace(/[^\d]/g, "")) || 0;
      const qty = Math.max(1, Math.min(10, Number(it.qty) || 1));
      // 옵션별재고 확인
      const stockMap: Record<string, number> = {};
      for (const pair of String(p.get("옵션별재고") || "").split("|")) {
        const [k, v] = pair.split(":");
        if (k && v) stockMap[k.trim()] = Number(v) || 0;
      }
      const key = it.color && it.size ? `${it.color}_${it.size}` : (it.size || it.color || "");
      const avail = stockMap[key] ?? Object.values(stockMap).reduce((a, b) => Math.max(a, b), 0);
      if (avail < qty) {
        return NextResponse.json({ ok: false, error: `품절: ${it.sku} ${key} 잔여 ${avail}개` }, { status: 409 });
      }
      total += price * qty;
      resolved.push({ sku: it.sku, color: it.color || "", size: it.size || "", qty, unit_price: price, supplier: String(p.get("공급사명") || "") });
    }

    // ── 3. 분리배송 판별 (공급사명 기준 그룹핑) ──
    const supplierSet = new Set(resolved.map((r) => r.supplier));
    const suppliers = Array.from(supplierSet);
    const shipType = suppliers.length > 1 ? "분리배송" : "단일배송";

    // ── 4. 주문번호 생성 + 시트 인입 ──
    const now = new Date();
    const orderId = `ORD-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(now.getMilliseconds()).padStart(3, "0")}${String(Math.floor(Math.random() * 90) + 10)}`;
    let ordersSheet;
    try {
      ordersSheet = doc.sheetsByTitle["Orders"];
    } catch {
      return NextResponse.json({ ok: false, error: "Orders 시트 없음" }, { status: 500 });
    }
    await ordersSheet.addRow({
      "주문번호": orderId,
      "주문일시": now.toISOString(),
      "결제수단": "bank_transfer",
      "결제상태": "입금대기",
      "입금자명": customer.depositor || customer.name,
      "PG거래ID": "",
      "고객명": customer.name,
      "연락처": customer.phone,
      "배송지": customer.address,
      "주문항목": JSON.stringify(resolved),
      "총결제금액": String(total),
      "배송유형": shipType,
      "출고그룹": suppliers.join(", "),
      "알림발송": shipType === "분리배송" ? "대기" : "-",
      "배송상태": "접수",
      "택배사": "",
      "송장번호": "",
      "CS메모": "",
    });

    // ── 5. 재고 차감 (Products 옵션별재고) — getCell 직접 갱신 (검증된 방식) ──
    const stockSheet = doc.sheetsByIndex[0];
    const newValByRow: Record<number, string> = {};
    for (const r of resolved) {
      const pIndex = pRows.findIndex((pr) => pr.get("상품ID") === r.sku);
      if (pIndex === -1) continue;
      const prow = pRows[pIndex];
      const stockMap: Record<string, number> = {};
      for (const pair of String(prow.get("옵션별재고") || "").split("|")) {
        const [k, v] = pair.split(":");
        if (k && v) stockMap[k.trim()] = Number(v) || 0;
      }
      const key = r.color && r.size ? `${r.color}_${r.size}` : (r.size || r.color || "");
      let tKey = key;
      if (!(tKey in stockMap)) {
        // mojibake 폴백: 사이즈+요청 길이로 후보 키 탐색 (색상_사이즈 조합 1:1 매칭)
        const sizePart = r.size || "";
        const cand = Object.keys(stockMap).filter((k) => k.endsWith(`_${sizePart}`) || k === sizePart);
        if (cand.length === 1) tKey = cand[0];
      }
      if (stockMap[tKey] !== undefined) stockMap[tKey] = Math.max(0, stockMap[tKey] - r.qty);
      newValByRow[pIndex + 2] = Object.entries(stockMap).map(([k, v]) => `${k}:${v}`).join("|"); // +2: 헤더 보정
    }
    console.log("[stock-decrement] 대상 행:", Object.keys(newValByRow), "값:", newValByRow);
    await stockSheet.loadCells(`AB2:AB${pRows.length + 1}`); // AB열 = 옵션별재고(28)
    for (const [rowNum, val] of Object.entries(newValByRow)) {
      const cell = stockSheet.getCell(Number(rowNum) - 1, 27); // 0-based: 행-1, 열 27=AB
      cell.value = val;
    }
    await stockSheet.saveUpdatedCells();
    console.log("[stock-decrement] 저장 완료");

    // ── 6. 디렉터 텔레그램 알림 ──
    const itemsDesc = resolved.map((r) => `${r.sku}(${r.color}${r.size ? " " + r.size : ""})x${r.qty}`).join(", ");
    await notifyNewOrder(orderId, customer.name, total, shipType, itemsDesc);

    // ── 7. 고객 응답 (입금 안내 포함) ──
    return NextResponse.json({
      ok: true,
      order_id: orderId,
      total_amount: total,
      shipping: {
        type: shipType,
        notice: shipType === "분리배송"
          ? "고객님의 주문 상품은 신속한 출고를 위해 각각 개별 포장되어 순차 발송됩니다."
          : undefined,
      },
      deposit_info: {
        bank: "국민은행",
        account: "123456-01-789012", // ⚠️ 디렉터님 실제 계좌로 교체 필요
        holder: "N°1",
        amount: total,
        depositor: customer.depositor || customer.name,
        due_hours: 24,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
