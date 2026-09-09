/**
 * N°1 — Lookbook 이미지 서빙 (로컬 정적 파일)
 * GET /api/lookbook/[pid] → 해당 품번 폴더의 이미지 5장 URL 배열 반환
 *
 * [SESSION L · TASK 29] 미디어 조회 실패는 우아한 열화(complete:false, images:[])로
 * 응답한다 — 핸들러 크래시·내부 오류 원문 노출 없음. 클라이언트는 이미지 부재만
 * 경험하고 실패 문구가 필요하지 않은 비본질 미디어다.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

const LOOKBOOK_DIR = path.join(process.cwd(), "lookbook");

export async function GET(
  _req: Request,
  { params }: { params: { pid: string } }
) {
  try {
    const dir = path.join(LOOKBOOK_DIR, params.pid);
    const shots = ["01_full", "02_45deg", "03_90deg", "04_back", "05_product"];

    const images = shots
      .filter((s) => fs.existsSync(path.join(dir, `${s}.jpg`)))
      .map((s) => `/lookbook/${params.pid}/${s}.jpg`);

    return NextResponse.json({
      ok: true,
      pid: params.pid,
      complete: images.length === 5,
      images,
    });
  } catch (e: unknown) {
    logInternal("api/lookbook", e);
    return NextResponse.json({ ok: true, pid: params.pid, complete: false, images: [] });
  }
}
