/**
 * N°1 — Lookbook 이미지 서빙 (로컬 정적 파일)
 * GET /api/lookbook/[pid] → 해당 품번 폴더의 이미지 5장 URL 배열 반환
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const LOOKBOOK_DIR = path.join(process.cwd(), "lookbook");

export async function GET(
  _req: Request,
  { params }: { params: { pid: string } }
) {
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
}
