/**
 * N°1 — 드라이브 폴더 내 파일 목록 API (Vercel 호환 v3)
 * GET /api/lookbook-files?folder={folderId}
 * 인증 우선순위:
 *   1) GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (서비스계정 JWT — products API와 동일, 안정적)
 *   2) DRIVE_REFRESH_TOKEN + DRIVE_CLIENT_ID + DRIVE_CLIENT_SECRET
 *   3) 로컬 token.json / oauth_client.json
 * 반환: files(샷순 정렬) + thumb(01_full 썸네일 URL)
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { JWT } from "google-auth-library";

export const dynamic = "force-dynamic";

async function getAccessToken(mode: { which: string }): Promise<string> {
  // 1) 서비스계정 (products API와 동일 env 재사용)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const client = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    mode.which = "svc";
    const tokens = await client.authorize();
    return tokens.access_token as string;
  }

  // 2) OAuth refresh token env
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
    mode.which = "oauth-env";
    return data.access_token;
  }

  // 3) 로컬 token.json
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
    if (!data.access_token) throw new Error("토큰 갱신 실패");
    accessToken = data.access_token;
    fs.writeFileSync(tokenPath, JSON.stringify({ ...token, access_token: accessToken, expiry_date: Date.now() + data.expires_in * 1000 }));
  }
  mode.which = "oauth-local";
  return accessToken;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ ok: false, files: [], thumb: null }, { status: 400 });
  }
  const mode = { which: "?" };
  try {
    const accessToken = await getAccessToken(mode);
    const params = new URLSearchParams({
      q: `'${folder}' in parents and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const data = await driveRes.json();
    if (!driveRes.ok || data.error) {
      return NextResponse.json({ ok: false, error: `drive ${driveRes.status}: ${JSON.stringify(data).slice(0, 200)}`, files: [], thumb: null }, { status: 502 });
    }

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
