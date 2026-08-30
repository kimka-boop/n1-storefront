/**
 * [회원 API] 초간편 회원가입/로그인 + 스마트핏 프로필 저장
 * POST /api/auth  { action: "register"|"login"|"profile", email, password, profile? }
 * 저장: Vercel 인메모리 (전역) + Google Sheets [Users] 시트 영구 저장
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __userStore: { users: Record<string, any>; sessions: Record<string, string> } | undefined;
}
const mem = () => {
  if (!global.__userStore) global.__userStore = { users: {}, sessions: {} };
  return global.__userStore;
};

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
  const auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const doc = new GoogleSpreadsheet(loadSheetId(), auth);
  await doc.loadInfo();
  return doc;
}

async function getOrCreateUsersSheet(doc: any) {
  try {
    return doc.sheetsByTitle["Users"];
  } catch {
    const s = await doc.addSheet({ title: "Users", headerValues: ["이메일", "비밀번호해시", "성별", "기준사이즈", "핏취향", "가입일"] });
    return s;
  }
}

// 간단 해시 (실서비스 전환 시 bcrypt 권장)
function hash(pw: string): string {
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) - h + pw.charCodeAt(i)) | 0;
  return "h" + Math.abs(h).toString(36) + pw.length;
}

function genToken(email: string): string {
  return "tok_" + Buffer.from(email + Date.now()).toString("base64url").slice(0, 24);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;
    const email = String(body.email || "").trim().toLowerCase();
    const store = mem();

    // ═══ 회원가입 (2단계 완료 시 호출) ═══
    if (action === "register") {
      const pw = String(body.password || "");
      const profile = body.profile || {};
      if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ ok: false, error: "올바른 이메일 형식이 아닙니다" }, { status: 400 });
      if (pw.length < 6) return NextResponse.json({ ok: false, error: "비밀번호는 6자 이상" }, { status: 400 });
      if (!profile.gender || !profile.size || !profile.fit) return NextResponse.json({ ok: false, error: "스마트핏 프로필 누락" }, { status: 400 });

      // 중복 확인 (메모리 + 시트)
      if (store.users[email]) return NextResponse.json({ ok: false, error: "이미 가입된 이메일입니다" }, { status: 409 });
      const doc = await getDoc();
      const sheet = await getOrCreateUsersSheet(doc);
      const rows = await sheet.getRows();
      if (rows.some((r: any) => r.get("이메일") === email))
        return NextResponse.json({ ok: false, error: "이미 가입된 이메일입니다" }, { status: 409 });

      // 시트 적재 (영구)
      await sheet.addRow({
        "이메일": email,
        "비밀번호해시": hash(pw),
        "성별": profile.gender,
        "기준사이즈": profile.size,
        "핏취향": profile.fit,
        "가입일": new Date().toISOString(),
      });
      store.users[email] = { profile, hash: hash(pw) };
      const token = genToken(email);
      store.sessions[token] = email;
      return NextResponse.json({ ok: true, token, profile });
    }

    // ═══ 로그인 ═══
    if (action === "login") {
      const pw = String(body.password || "");
      const doc = await getDoc();
      const sheet = await getOrCreateUsersSheet(doc);
      const rows = await sheet.getRows();
      const user = rows.find((r: any) => r.get("이메일") === email);
      if (!user || user.get("비밀번호해시") !== hash(pw))
        return NextResponse.json({ ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다" }, { status: 401 });
      const profile = {
        gender: user.get("성별"), size: user.get("기준사이즈"), fit: user.get("핏취향"),
      };
      const token = genToken(email);
      store.sessions[token] = email;
      return NextResponse.json({ ok: true, token, profile });
    }

    // ═══ 프로필 갱신 ═══
    if (action === "profile") {
      const token = String(body.token || "");
      const email2 = store.sessions[token];
      if (!email2) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });
      const profile = body.profile || {};
      const doc = await getDoc();
      const sheet = await getOrCreateUsersSheet(doc);
      const rows = await sheet.getRows();
      const user = rows.find((r: any) => r.get("이메일") === email2);
      if (user) {
        user.set("성별", profile.gender || user.get("성별"));
        user.set("기준사이즈", profile.size || user.get("기준사이즈"));
        user.set("핏취향", profile.fit || user.get("핏취향"));
        await user.save();
      }
      return NextResponse.json({ ok: true, profile });
    }

    return NextResponse.json({ ok: false, error: "알 수 없는 action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ ok: false, error: "token 누락" }, { status: 400 });
  const store = mem();
  const email = store.sessions[token];
  if (!email) return NextResponse.json({ ok: false, error: "세션 만료" }, { status: 401 });
  return NextResponse.json({ ok: true, email, profile: store.users[email]?.profile || null });
}
