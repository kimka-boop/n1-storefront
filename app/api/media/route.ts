/**
 * N°1 — Product Media API (6-slot + QA 구조)
 * GET  /api/media?pid=PRD-M-01  → 해당 상품의 6슬롯 상태 + completeness
 * GET  /api/media               → 전체 Product Media rows (admin 용도)
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";
import { parseMediaRows, evaluateMedia, MEDIA_SLOTS } from "@/lib/media";

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

async function getMediaDoc() {
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
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(loadSheetId(), auth);
  await doc.loadInfo();
  return doc;
}

export async function GET(req: Request) {
  try {
    const doc = await getMediaDoc();
    let sheet;
    try {
      sheet = doc.sheetsByTitle["Product Media"];
    } catch {
      return NextResponse.json({ ok: false, error: "Product Media 시트 없음" }, { status: 500 });
    }
    const rawRows = await sheet.getRows();
    const media = parseMediaRows(
      rawRows.map((r: any) => r.toObject())
    );

    const pid = new URL(req.url).searchParams.get("pid");
    if (pid) {
      const ev = evaluateMedia(pid, media);
      return NextResponse.json({ ok: true, pid, ...ev });
    }

    // 전체: 상품별 aggregate 계산
    const pids = Array.from(new Set(media.map((m) => m.productId)));
    const summary = pids.map((p) => {
      const ev = evaluateMedia(p, media);
      return { productId: p, passCount: ev.passCount, aggregate: ev.aggregate, complete: ev.complete };
    });
    return NextResponse.json({ ok: true, slots: MEDIA_SLOTS, total: media.length, summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
