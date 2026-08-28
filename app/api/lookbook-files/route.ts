/**
 * N°1 — 드라이브 폴더 내 파일 목록 API (Vercel 호환)
 * GET /api/lookbook-files?folder={folderId}
 * 토큰: 환경변수 DRIVE_REFRESH_TOKEN + DRIVE_CLIENT_ID + DRIVE_CLIENT_SECRET
 *   또는 로컬 token.json / oauth_client.json
 * 반환: files(이름순 정렬) + thumb(01_full 뷰 URL)
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

async function getAccessToken(): Promise<string> {
  // 1) 환경변수 우선 (Vercel)
  const refreshToken = process.env.DRIVE_REFRESH_TOKEN;
  const clientId = process.env.DRIVE_CLIENT_ID;
  const clientSecret = process.env.DRIVE_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(data).slice(0, 150)}`);
    return data.access_token;
  }

  // 2) 로컬 token.json 폴백
  const tokenPath = path.join(process.cwd(), "..", "token.json");
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const clientPath = path.join(process.cwd(), "..", "oauth_client.json");
  const client = JSON.parse(fs.readFileSync(clientPath, "utf-8"));

  let accessToken = token.access_token || "";
  if (Date.now() > (token.expiry_date || 0) - 60_000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.installed.client_id,
        client_secret: client.installed.client_secret,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`토큰 갱신 실패`);
    accessToken = data.access_token;
    fs.writeFileSync(tokenPath, JSON.stringify({ ...token, access_token: accessToken, expiry_date: Date.now() + data.expires_in * 1000 }));
  }
  return accessToken;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ ok: false, files: [], thumb: null }, { status: 400 });
  }
  try {
    const accessToken = await getAccessToken();
    const params = new URLSearchParams({
      q: `'${folder}' in parents and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: "true",
    });
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const data = await driveRes.json();

    const order: Record<string, number> = { "01_full": 1, "02_45deg": 2, "03_90deg": 3, "04_back": 4, "05_product": 5 };
    const sorted = (data.files || []).sort(
      (a: any, b: any) => (order[a.name.replace(/\.\w+$/, "")] || 9) - (order[b.name.replace(/\.\w+$/, "")] || 9)
    );

    const full = sorted.find((f: any) => f.name.startsWith("01_full"));
    const thumb = full ? `https://drive.google.com/thumbnail?id=${full.id}&sz=w800` : null;

    return NextResponse.json({ ok: true, files: sorted, thumb });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, files: [], thumb: null }, { status: 500 });
  }
}
