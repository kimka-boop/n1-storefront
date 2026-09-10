/**
 * [서버 전용] Auth + 이메일 검증 토큰의 Google Sheets 영구 저장소 계층.
 *
 * app/api/auth(회원 API)와 app/api/auth/verify(인증 링크)가 같은 스토어 인스턴스를
 * 쓰도록 하는 단일 지점이다 — 분리되면 인증 링크 확인이 다른 메모리 인덱스를 보게 된다.
 * 시크릿은 env(.env.local: N1_SHEET_ID/GOOGLE_*)에서만 읽는다 — 값을 반환·기록하지 않는다.
 */
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
import {
  VERIFY_PURPOSE_SIGNUP,
  VerifyTokenStore,
  VerificationRecord,
} from "@/lib/emailVerify";

export declare type VerifyPurpose = typeof VERIFY_PURPOSE_SIGNUP;

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

/** 이메일인증 컬럼 값 — "확인" | "인증대기"(신규 정책의 미인증) | "미확인"(레거시, grandfathered) */
export const VERIFY_COL_VERIFIED = "확인";
export const VERIFY_COL_PENDING = "인증대기";
export const VERIFY_COL_LEGACY = "미확인";

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
    // [SESSION L] google-spreadsheet v5 API명은 setHeaderRow다 — setHeaderValues(v4)는
    // 존재하지 않아 TypeError로 /api/auth 전체가 실패했다 (런타임 스모크로 발견).
    await sheet.setHeaderRow([...hv, ...missing]);
  }
  return sheet;
}

function rowToAccount(r: any): Account | null {
  const email = String(r.get("이메일") || "").trim().toLowerCase();
  const hash = String(r.get("비밀번호해시") || "");
  if (!email || !hash) return null;
  const verifyState = String(r.get("이메일인증") || "").trim();
  // 레거시 행(아이디 없이 이메일로만 가입)은 username을 지어내지 않는다 —
  // 이메일 로그인만 가능하며, 아이디는 사용자가 직접 정한 값만 유효하다.
  return {
    username: normalizeUsername(r.get("사용자이름")),
    email,
    hash,
    profile: {
      gender: String(r.get("성별") || "미지정"),
      size: String(r.get("기준사이즈") || ""),
      fit: String(r.get("핏취향") || ""),
    },
    createdAt: String(r.get("가입일") || new Date().toISOString()),
    emailVerified: verifyState === VERIFY_COL_VERIFIED,
    // "인증대기"만 로그인 게이트 대상 — 레거시 "미확인"은 기존 회원 자격 유지(grandfathered)
    verificationPending: verifyState === VERIFY_COL_PENDING,
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
        "이메일인증": a.emailVerified ? VERIFY_COL_VERIFIED : a.verificationPending ? VERIFY_COL_PENDING : VERIFY_COL_LEGACY,
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
    async markVerified(email: string) {
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => String(r.get("이메일") || "").trim().toLowerCase() === email);
      if (row) {
        row.set("이메일인증", VERIFY_COL_VERIFIED);
        await row.save();
      }
    },
    async updateEmail(oldEmail: string, newEmail: string) {
      const rows = await sheet.getRows();
      const row = rows.find((r: any) => String(r.get("이메일") || "").trim().toLowerCase() === oldEmail);
      if (!row) throw new Error("pending account row not found");
      row.set("이메일", newEmail);
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

declare global {
  // eslint-disable-next-line no-var
  var __authStore: AuthStore | undefined;
}

let seeded = false;

/** 프로세스 공용 AuthStore — auth 라우트와 verify 라우트가 같은 인스턴스를 쓴다. */
export async function ensureStore(): Promise<AuthStore> {
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

/* ── Email_Verifications 시트 — 토큰 해시 저장소 (raw 토큰은 저장되지 않는다) ── */
const VERIFY_HEADERS = ["토큰해시", "이메일", "목적", "생성일", "만료일", "사용일"];
const INVALIDATED = "무효화";

async function getVerificationSheet(doc: any) {
  await doc.loadInfo();
  let sheet = Object.values(doc.sheetsByTitle || {}).find((s: any) => s.title === "Email_Verifications") as any;
  if (!sheet) {
    sheet = await doc.addSheet({ title: "Email_Verifications", headerValues: VERIFY_HEADERS });
  } else {
    await sheet.loadHeaderRow();
  }
  return sheet;
}

/** 토큰 저장소 — Email_Verifications 시트. 저장값은 항상 sha256 해시다. */
export async function getVerificationStore(): Promise<VerifyTokenStore> {
  const sheet = await getVerificationSheet(await getDoc());
  const normEmail = (v: unknown) => String(v || "").trim().toLowerCase();
  return {
    async issue(record: VerificationRecord) {
      // 재발급 시 기존 미사용 토큰은 issueVerifyToken이 invalidateAll로 먼저 무효화한다
      await sheet.addRow({
        "토큰해시": record.tokenHash,
        "이메일": record.email,
        "목적": record.purpose,
        "생성일": record.createdAt,
        "만료일": record.expiresAt,
        "사용일": record.usedAt || "",
      });
    },
    async find(tokenHash: string) {
      const rows = await sheet.getRows();
      // 사용·무효화 레코드도 돌려준다 — confirm이 USED를 정확히 판정해야 하기 때문
      const row = rows.find((r: any) => String(r.get("토큰해시") || "") === tokenHash);
      if (!row) return null;
      return {
        tokenHash,
        email: normEmail(row.get("이메일")),
        purpose: String(row.get("목적") || "") as VerificationRecord["purpose"],
        createdAt: String(row.get("생성일") || ""),
        expiresAt: String(row.get("만료일") || ""),
        usedAt: String(row.get("사용일") || "") || null,
      };
    },
    async markUsed(tokenHash: string, usedAt: string) {
      const rows = await sheet.getRows();
      const row = rows.find(
        (r: any) =>
          String(r.get("토큰해시") || "") === tokenHash &&
          String(r.get("사용일") || "") === "",
      );
      if (!row) return false;
      row.set("사용일", usedAt);
      await row.save();
      return true;
    },
    async invalidateAll(email: string, purpose: string) {
      const rows = await sheet.getRows();
      const targets = rows.filter(
        (r: any) =>
          normEmail(r.get("이메일")) === email &&
          String(r.get("목적") || "") === purpose &&
          String(r.get("사용일") || "") === "",
      );
      for (const row of targets) {
        row.set("사용일", INVALIDATED);
        await row.save();
      }
    },
    async lastIssuedAt(email: string, purpose: string) {
      const rows = await sheet.getRows();
      let last: string | null = null;
      for (const r of rows) {
        if (normEmail(r.get("이메일")) !== email) continue;
        if (String(r.get("목적") || "") !== purpose) continue;
        const created = String(r.get("생성일") || "");
        if (created && (!last || created > last)) last = created;
      }
      return last;
    },
  };
}
