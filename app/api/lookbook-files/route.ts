/**
 * N°1 — 드라이브 폴더 내 파일 목록 API
 * GET /api/lookbook-files?folder={folderId} → [{id, name}]
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ ok: false, files: [] }, { status: 400 });
  }
  try {
    // token.json에서 OAuth 토큰 직접 사용 (drive_oauth.py와 동일 계정)
    const tokenPath = path.join(process.cwd(), "..", "token.json");
    const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const clientPath = path.join(process.cwd(), "..", "oauth_client.json");
    const client = JSON.parse(fs.readFileSync(clientPath, "utf-8"));

    let accessToken = token.access_token || "";
    if (Date.now() > (token.expiry_date || 0) - 60_000) {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.installed.client_id,
          client_secret: client.installed.client_secret,
          refresh_token: token.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(data).slice(0, 150)}`);
      accessToken = data.access_token;
      fs.writeFileSync(tokenPath, JSON.stringify({ ...token, access_token: accessToken, expiry_date: Date.now() + data.expires_in * 1000 }));
    }

    const params = new URLSearchParams({
      q: `'${folder}' in parents and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: "true",
    });
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await driveRes.json();
    return NextResponse.json({ ok: true, files: data.files || [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, files: [] }, { status: 500 });
  }
}
