/**
 * N°1 — 시트 실시간 연동 API (Route Handler)
 * GET /api/products → 구글 시트 Products(한국어 헤더)에서 데이터를 읽어 JSON으로 반환
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

async function getSheetRows() {
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

  const serviceAccountAuth = new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
  const doc = new GoogleSpreadsheet(loadSheetId(), serviceAccountAuth);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0]; // Products
  const rows = await sheet.getRows();

  return rows.map((r) => {
    // 옵션별재고: "L:10|XL:5|2XL:0" 파싱
    const rawStock = r.get("옵션별재고") || "";
    const optionStock: Record<string, number> = {};
    for (const pair of rawStock.split("|")) {
      const [k, v] = pair.split(":");
      if (k && v !== undefined && v !== "") optionStock[k.trim()] = Number(v) || 0;
    }
    return {
      id: r.get("상품ID") || "",
      name: r.get("상품명") || "",
      category: r.get("카테고리") || "",
      price: Number(String(r.get("판매가") || "0").replace(/[^\d]/g, "")) || 0,
      stockStatus: r.get("재고상태") || "",
      lookbookStatus: r.get("룩북상태") || "",
      lookbookImage: r.get("룩북이미지URL") || "",
      lookbookDrive: (r.get("룩북이미지URL") || "").startsWith("https://drive.google.com") ? r.get("룩북이미지URL") : "",
      lookbookLocal: (r.get("룩북이미지URL") || "").startsWith("lookbook/") ? r.get("룩북이미지URL") : "",
      // ── 상품 디테일 (D2C) ──
      material: r.get("소재") || "",
      washingInfo: r.get("세탁정보") || "",
      sizeChart: r.get("실측사이즈") || "",
      modelInfo: r.get("모델정보") || "",
      fit: {
        thickness: r.get("두께감") || "",
        stretch: r.get("신축성") || "",
        sheer: r.get("비침") || "",
        lining: r.get("안감") || "",
        shape: r.get("핏감") || "",
      },
      origin: r.get("원산지") || "",
      notice: {
        manufacturer: r.get("제조자") || "",
        madeAt: r.get("제조연월") || "",
        colorSize: "상세페이지 참조",
        quality: "전자상거래 법에 규정되어 있는 소비자 청약철회 가능 범위를 준수합니다.",
        as: "N°1 고객센터 (상품 문의는 페이지 하단 문의하기 이용)",
      },
      // ── 옵션 & 재고 (D2C 구매 UI) ──
      colorOptions: (r.get("색상옵션") || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      sizeOptions: (r.get("사이즈옵션") || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      optionStock,
    };
  });
}

export async function GET() {
  try {
    const products = await getSheetRows();
    return NextResponse.json({ ok: true, products, updatedAt: new Date().toISOString() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, products: [] }, { status: 500 });
  }
}
