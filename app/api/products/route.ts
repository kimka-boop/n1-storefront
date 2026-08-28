/**
 * N°1 — 시트 실시간 연동 API (Route Handler)
 * GET /api/products → 구글 시트 Products에서 데이터를 읽어 JSON으로 반환
 * credentials.json 파일을 직접 읽어 인증하므로 키를 env에 복사할 필요가 없다.
 * 시트가 바뀌면 홈페이지가 다음 요청 때 자동으로 반영된다.
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic"; // 캐시 없이 매 요청 시트를 읽음

// .env 파일을 런타임에 직접 로드 (next start는 .env의 확장 변수를 안 읽을 수 있음)
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
  // Vercel: 환경변수 / 로컬: credentials.json 파일 — 둘 다 지원
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
  return rows.map((r) => ({
    id: r.get("Product_ID") || "",
    name: r.get("Product_Name") || "",
    category: r.get("Category") || "",
    supplier: r.get("Supplier_Name") || "",
    supplierUrl: r.get("Supplier_URL") || "",
    supplyPrice: Number(String(r.get("Supply_Price") || "0").replace(/[^\d]/g, "")) || 0,
    price: Number(String(r.get("Selling_Price") || "0").replace(/[^\d]/g, "")) || 0,
    stockStatus: r.get("Stock_Status") || "",
    lookbookStatus: r.get("Lookbook_Status") || "",
    // 로컬 경로와 드라이브 URL 중 있는 쪽 반환 (양쪽 모두 지원)
    lookbookImage: r.get("Lookbook_Image_URL") || "",
    lookbookDrive: (r.get("Lookbook_Image_URL") || "").startsWith("https://drive.google.com") ? r.get("Lookbook_Image_URL") : "",
    lookbookLocal: (r.get("Lookbook_Image_URL") || "").startsWith("lookbook/") ? r.get("Lookbook_Image_URL") : "",
  }));
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
