/**
 * N°1 — Lookbook 이미지 서빙 (6-slot + QA 구조)
 * GET /api/lookbook/[pid]
 *
 * CORE OPERATING SPEC v1.0:
 *  - 파일 존재 ≠ 미디어 완성
 *  - Product Media 시트의 media_type/qa_status를 함께 확인
 *  - 6슬롯 모두 MEDIA_QA_PASS → complete: true, 그 외 false
 *
 * Media metadata가 없는 상품(파이프라인 미시작)은
 * MEDIA_INCOMPLETE + 슬롯별 MEDIA_PENDING 상태로 반환한다.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const LOOKBOOK_DIR = path.join(process.cwd(), "lookbook");

// 규격 6-slot: 폴더 파일명 ↔ media_type 매핑
const SLOT_FILES: Record<string, string> = {
  "01": "01_full",       // AI_MODEL_FRONT
  "02": "02_45deg",      // AI_MODEL_45DEG
  "03": "03_90deg",      // AI_MODEL_90DEG
  "04": "04_back",       // AI_MODEL_BACK
  "05": "05_cutout",     // AI_PRODUCT_CUTOUT
  "06": "06_reel",       // AI_PRODUCT_REEL (9:16 영상)
};

const SLOT_TYPES: Record<string, string> = {
  "01": "AI_MODEL_FRONT",
  "02": "AI_MODEL_45DEG",
  "03": "AI_MODEL_90DEG",
  "04": "AI_MODEL_BACK",
  "05": "AI_PRODUCT_CUTOUT",
  "06": "AI_PRODUCT_REEL",
};

async function loadMediaQa(pid: string): Promise<Record<string, { qaStatus: string; mediaUrl: string }>> {
  // Product Media 시트에서 해당 pid의 QA 상태 조회 (동적 import로 circular 방지)
  try {
    const { GoogleSpreadsheet } = await import("google-spreadsheet");
    const { JWT } = await import("google-auth-library");
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
    let sheetId = process.env.N1_SHEET_ID;
    if (!sheetId) {
      try {
        for (const line of fs.readFileSync(path.join(process.cwd(), "..", ".env"), "utf-8").split("\n")) {
          if (line.startsWith("N1_SHEET_ID=")) sheetId = line.split("=")[1].trim();
        }
      } catch {}
    }
    if (!sheetId) return {};
    const auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["Product Media"];
    if (!sheet) return {};
    const rows = await sheet.getRows();
    const out: Record<string, { qaStatus: string; mediaUrl: string }> = {};
    for (const r of rows) {
      if (String(r.get("product_id") || "").trim() !== pid) continue;
      const raw = String(r.get("media_order") || "").trim();
      const order = /^\d+$/.test(raw) ? String(Number(raw)).padStart(2, "0") : raw;
      out[order] = {
        qaStatus: String(r.get("qa_status") || "MEDIA_PENDING").trim(),
        mediaUrl: String(r.get("media_url") || "").trim(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { pid: string } }
) {
  const dir = path.join(LOOKBOOK_DIR, params.pid);
  const qa = await loadMediaQa(params.pid);

  const slots = Object.entries(SLOT_FILES).map(([order, fileBase]) => {
    // 파일 후보: .jpg / .mp4(릴스)
    const candidates =
      order === "06"
        ? [`${fileBase}.mp4`, `${fileBase}.webm`]
        : [`${fileBase}.jpg`, `${fileBase}.png`, `${fileBase}.webp`];
    const found = candidates.find((c) => fs.existsSync(path.join(dir, c)));
    const qaInfo = qa[order];
    return {
      media_order: order,
      media_type: SLOT_TYPES[order],
      file_exists: Boolean(found),
      url: found ? `/lookbook/${params.pid}/${found}` : (qaInfo?.mediaUrl || ""),
      qa_status: qaInfo?.qaStatus || (found ? "MEDIA_NEEDS_REVIEW" : "MEDIA_PENDING"),
    };
  });

  const complete =
    slots.length === 6 &&
    slots.every((s) => s.qa_status === "MEDIA_QA_PASS" && (s.file_exists || s.url));

  return NextResponse.json({
    ok: true,
    pid: params.pid,
    slots,
    pass_count: slots.filter((s) => s.qa_status === "MEDIA_QA_PASS").length,
    aggregate: complete ? "MEDIA_COMPLETE" : "MEDIA_INCOMPLETE",
    complete,
    // 하위 호환: 기존 images 배열 (QA_PASS + 파일 존재 슬롯만)
    images: slots
      .filter((s) => s.qa_status === "MEDIA_QA_PASS" && s.url)
      .map((s) => s.url),
  });
}
