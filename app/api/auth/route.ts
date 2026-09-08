/**
 * [회원 API — Session A AUTH FOUNDATION] 아이디·이메일 회원가입/로그인 + 스마트핏 프로필
 * POST /api/auth
 *   { action: "check-username", username }              → 가용성 확인(가입 전 피드백)
 *   { action: "register", username, email, password,
 *     profile }                                          → 회원가입(서버 최종 중복 검사)
 *   { action: "login", id, password }                    → 로그인(아이디 또는 이메일)
 *   { action: "profile", token, profile?, resetFitProfile? } → 핏 프로필 갱신/초기화
 *   { action: "request-email-verify", email }            → EMAIL_VERIFY_DEFERRED 응답(§3)
 * GET  /api/auth?token=                                   → 세션/프로필 readback
 *
 * 유일성: Google Sheet에는 UNIQUE 제약이 없으므로 Sheet lookup만으로 유일성을
 * 보장하지 않는다 — lib/authServer.AuthStore의 프로세스 내 예약 인덱스가 1차
 * 제약(원자적), Sheet 사전 확인이 재시작 대비 2차 방어다.
 * 비밀번호: scrypt 해시만 저장(§2) — 평문은 시트·로그 어디에도 남지 않는다.
 */
import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import fs from "fs";
import path from "path";
import {
  Account,
  AuthPersistence,
  AuthStore,
  FitWire,
  normalizeUsername,
} from "@/lib/authServer";
import { deferredEmailVerify } from "@/lib/emailVerify";
import { RESET_FIT_PROFILE_FLAG } from "@/lib/fitContext";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __authStore: AuthStore | undefined;
}

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

/* ── Users 시트 — 기존 계약 컬럼 유지 + username/인증 컬럼 확장(끝에 덧붙임). ── */
const BASE_HEADERS = ["이메일", "비밀번호해시", "성별", "기준사이즈", "핏취향", "가입일"];
const EXT_HEADERS = ["사용자이름", "이메일인증"];

async function getUsersSheet(doc: any) {
  await doc.loadInfo();
  let sheet = Object.values(doc.sheetsByTitle || {}).find((s: any) => s.title === "Users") as any;
  if (!sheet) {
    sheet = await doc.addSheet({ title: "Users", headerValues: [...BASE_HEADERS, ...EXT_HEADERS] });
    return sheet;
  }
  await sheet.loadHeaderRow();
  const hv: string[] = sheet.headerValues || [];
  const missing = EXT_HEADERS.filter((h) => !hv.includes(h));
  if (missing.length) {
    // 기존 컬럼 순서는 그대로 두고 새 컬럼을 끝에 덧붙인다 — 레거시 행 호환.
    await sheet.setHeaderValues([...hv, ...missing]);
  }
  return sheet;
}

function rowToAccount(r: any): Account | null {
  const email = String(r.get("이메일") || "").trim().toLowerCase();
  const hash = String(r.get("비밀번호해시") || "");
  if (!email || !hash) return null;
  return {
    // 레거시 행(아이디 없이 이메일로만 가입)은 username을 지어내지 않는다 —
    // 이메일 로그인만 가능하며, 아이디는 사용자가 직접 정한 값만 유효하다.
    username: normalizeUsername(r.get("사용자이름")),
    email,
    hash,
    profile: {
      gender: String(r.get("성별") || "미지정"),
      size: String(r.get("기준사이즈") || ""),
      fit: String(r.get("핏취향") || ""),
    },
    createdAt: String(r.get("가입일") || new Date().toISOString()),
    emailVerified: false, // §3 — 인증 계약 활성화 전까지 항상 false
  };
}

/** 영구 저장소 어댑터 — Google Sheets Users 시트. AuthStore가 이 포트를 호출한다. */
async function sheetPersistence(): Promise<AuthPersistence & { seedAll(store: AuthStore): Promise<void> }> {
  const sheet = await getUsersSheet(await getDoc());
  return {
    async exists(username: string, email: string) {
      const rows = await sheet.getRows();
      return rows.some((r: any) => {
        const ru = normalizeUsername(r.get("사용자이름"));
        const re = String(r.get("이메일") || "").trim().toLowerCase();
        return (ru && ru === username) || re === email;
      });
    },
    async create(a: Account) {
      await sheet.addRow({
        "이메일": a.email,
        "비밀번호해시": a.hash,
        "성별": a.profile.gender,
        "기준사이즈": a.profile.size,
        "핏취향": a.profile.fit,
        "가입일": a.createdAt,
        "사용자이름": a.username,
        "이메일인증": a.emailVerified ? "확인" : "미확인",
      });
    },
    async updateHash(email: string, hash: string) {
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => String(r.get("이메일") || "").trim().toLowerCase() === email);
      if (row) {
        row.set("비밀번호해시", hash);
        await row.save();
      }
    },
    async updateProfile(email: string, profile: FitWire | null) {
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => String(r.get("이메일") || "").trim().toLowerCase() === email);
      if (!row) return;
      if (!profile) {
        // reset — 핏 필드 공백화(§9). 주문/결제 기록은 이 시트와 무관하다.
        row.set("성별", "미지정");
        row.set("기준사이즈", "");
        row.set("핏취향", "");
      } else {
        row.set("성별", profile.gender);
        row.set("기준사이즈", profile.size);
        row.set("핏취향", profile.fit);
      }
      await row.save();
    },
    async seedAll(store: AuthStore) {
      const rows = await sheet.getRows();
      for (const r of rows) {
        const a = rowToAccount(r);
        if (a) store.seed(a);
      }
    },
  };
}

let seeded = false;
async function ensureStore(): Promise<AuthStore> {
  if (global.__authStore && seeded) return global.__authStore;
  if (!global.__authStore) {
    const persistence = await sheetPersistence();
    const store = new AuthStore(persistence);
    if (!seeded) {
      try {
        await persistence.seedAll(store);
      } catch {
        // 시트 조회 실패에도 서비스는 시작한다 — 등록 시 exists 재확인이 방어한다.
      }
      seeded = true;
    }
    global.__authStore = store;
  }
  return global.__authStore;
}

const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const store = await ensureStore();

    /* ═══ 아이디 가용성 확인 — 가입 전 인라인 피드백용 (§1) ═══ */
    if (action === "check-username") {
      const verdict = store.usernameAvailable(String(body.username || ""));
      // AI 판정 없음 — 결정적 서버 조회만 응답한다(§1 "AI 사용 금지").
      return NextResponse.json({ ok: true, username: normalizeUsername(body.username), ...verdict });
    }

    /* ═══ 회원가입 — 서버 최종 중복 검사 + scrypt 해시 저장 ═══ */
    if (action === "register") {
      const result = await store.register({
        username: body.username,
        email: body.email,
        password: body.password,
        profile: body.profile,
      });
      if (result.ok === false) return bad(result.error, result.status);
      const { account } = result;
      const token = store.createSession(account.email);
      return NextResponse.json({
        ok: true,
        token,
        email: account.email,
        username: account.username,
        profile: account.profile,
        emailVerified: account.emailVerified, // §3 — 항상 false (EMAIL_VERIFY_DEFERRED)
      });
    }

    /* ═══ 로그인 — 아이디 또는 이메일 ═══ */
    if (action === "login") {
      const id = String(body.id || body.email || body.username || "");
      const result = await store.login(id, body.password);
      if (result.ok === false) return bad(result.error, result.status);
      return NextResponse.json({
        ok: true,
        token: result.token,
        email: result.account.email,
        username: result.account.username,
        profile: result.account.profile,
        emailVerified: result.account.emailVerified,
      });
    }

    /* ═══ 핏 프로필 갱신 / 초기화 — authorized profile storage(§7·§9) ═══ */
    if (action === "profile") {
      const profile = body.profile
        ? {
            gender: String(body.profile.gender || "미지정"),
            size: String(body.profile.size || ""),
            fit: String(body.profile.fit || ""),
          }
        : undefined;
      const result = await store.updateProfile(body.token, profile, Boolean(body[RESET_FIT_PROFILE_FLAG]));
      if (result.ok === false) return bad(result.error, result.status || 401);
      return NextResponse.json({ ok: true, profile: result.profile });
    }

    /* ═══ 이메일 확인 — EMAIL_VERIFY_DEFERRED 계약(§3). provider 승인 전까지 지연. ═══ */
    if (action === "request-email-verify") {
      return NextResponse.json(await deferredEmailVerify.requestEmailVerify(String(body.email || "")));
    }

    return bad("알 수 없는 action", 400);
  } catch (e: unknown) {
    // 에러 응답에 요청 값(비밀번호 포함)을 절대 되돌려 주지 않는다(§2).
    return bad("서버 처리 중 문제가 발생했어요 — 잠시 후 다시 시도해 주세요", 500);
  }
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return bad("token 누락", 400);
  const store = await ensureStore();
  const account = store.accountOf(token);
  if (!account) return bad("세션 만료", 401);
  return NextResponse.json({
    ok: true,
    email: account.email,
    username: account.username,
    profile: account.profile,
    emailVerified: account.emailVerified,
  });
}
