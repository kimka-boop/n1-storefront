/**
 * N°1 AUTH FOUNDATION — 서버 인증 코어 (Session A, 2026-09-09)
 *
 * 설계 결정 (Session A 미션 §1·§2·§3):
 *  - 식별자: username(아이디) + email. username은 로그인 핸들이며 정규화
 *    (trim + 소문자) 후 유일해야 한다. email은 연락·복구 채널 — 소유 확인은
 *    EMAIL_VERIFY_DEFERRED(lib/emailVerify.ts)로 지연된다.
 *  - 유일성: Google Sheet에는 UNIQUE 제약이 없다 → Sheet lookup만으로는
 *    유일성을 보장할 수 없다. 대신 프로세스 내 레지스트리(인덱스 Map)에서
 *    "확인 + 예약"을 단일 동기 블록으로 수행한다(JS 단일 스레드 — await 없는
 *    check-then-reserve는 원자적이다). Sheet는 영구 저장소일 뿐.
 *  - 비밀번호: scrypt(N=16384, r=8, p=1, 32B) + 16B 랜덤 salt.
 *    포맷 "s1$<saltB64>$<hashB64>". 평문은 어디에도 저장·기록되지 않는다.
 *    구버전 약해시("h…" 레거시) 행은 로그인 시 검증 후 즉시 s1으로 승격한다.
 *  - 토큰: crypto.randomBytes 24B — 이메일 기반 예측 가능 토큰을 대체한다.
 *
 * 이 모듈은 Google/Next에 의존하지 않는다 — persistence는 주입받는다.
 * tests/authFoundation.test.cjs(A1–A4)가 실제 TypeScript로 이 로직을 검증한다.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { validateUsername } from "./username";

export { normalizeUsername, validateUsername } from "./username";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 32;

/* ─────────────────────────── email ─────────────────────────── */

/** 실용 이메일 문법 — 소유 확인이 아니라 형식 검증이다(§3, 인증은 지연 계약). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type EmailCheck =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateEmail(raw: unknown): EmailCheck {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return { ok: false, error: "이메일을 입력해 주세요" };
  if (!EMAIL_RE.test(value))
    return { ok: false, error: "올바른 이메일 형식이 아닙니다" };
  return { ok: true, value };
}

/* ───────────────────────── password ────────────────────────── */

export const PASSWORD_MIN = 6;

export function validatePassword(raw: unknown): { ok: boolean; error?: string } {
  const pw = typeof raw === "string" ? raw : "";
  if (pw.length < PASSWORD_MIN)
    return { ok: false, error: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요` };
  return { ok: true };
}

/** 현행 포맷 — scrypt. 평문·파생값 어디에도 원문 힌트를 남기지 않는다. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT_KEYLEN);
  return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** 구버전(초기 구현) 약해시 — 기존 Users 시트 행의 로그인 호환용. 신규 저장 금지. */
export function legacyHash(pw: string): string {
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) - h + pw.charCodeAt(i)) | 0;
  return "h" + Math.abs(h).toString(36) + pw.length;
}

export type VerifyResult = { ok: boolean; upgrade?: string };

/**
 * 저장된 해시 검증. 레거시 행이면 ok와 함께 새 s1 해시를 돌려준다 —
 * 호출자가 로그인 성공 시 저장소를 승격한다(투명 업그레이드).
 */
export async function verifyPassword(
  pw: string,
  stored: string | null | undefined,
): Promise<VerifyResult> {
  if (!stored) return { ok: false };
  if (stored.startsWith("s1$")) {
    const [, saltB64, hashB64] = stored.split("$");
    try {
      const expected = Buffer.from(hashB64, "base64");
      const actual = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length);
      return { ok: actual.length === expected.length && timingSafeEqual(actual, expected) };
    } catch {
      return { ok: false };
    }
  }
  // 레거시 행 — 맞으면 즉시 승격 해시 제공
  if (stored === legacyHash(pw)) {
    return { ok: true, upgrade: await hashPassword(pw) };
  }
  return { ok: false };
}

/* ─────────────────────────── store ─────────────────────────── */

export interface Account {
  username: string; // 정규형
  email: string; // 정규형
  hash: string; // s1 또는(레거시 행) 구버전
  profile: { gender: string; size: string; fit: string };
  createdAt: string;
  emailVerified: boolean; // §3 — EMAIL_VERIFY_DEFERRED 동안 항상 false
}

export type FitWire = { gender: string; size: string; fit: string };

/** 영구 저장소 포트 — Google Sheets 구현은 라우트가 주입한다. */
export interface AuthPersistence {
  /** 해당 username 또는 email이 영구 저장소에 이미 있는지 (프로세스 재시작 대비 2차 방어) */
  exists(username: string, email: string): Promise<boolean>;
  /** 신규 계정 영구 저장 */
  create(account: Account): Promise<void>;
  /** 레거시 해시 → s1 승격 (로그인 성공 시) — 없으면 no-op */
  updateHash?(email: string, hash: string): Promise<void>;
  /** 프로필 갱신 / reset=true면 핏 필드 공백화 */
  updateProfile?(email: string, profile: FitWire | null): Promise<void>;
}

export type RegisterResult =
  | { ok: true; account: Account }
  | { ok: false; status: number; error: string };

export class AuthStore {
  private byUsername = new Map<string, Account>();
  private byEmail = new Map<string, Account>();
  private reservedUsernames = new Set<string>();
  private reservedEmails = new Set<string>();
  private sessions = new Map<string, string>(); // token → email

  constructor(private persist: AuthPersistence) {}

  usernameAvailable(raw: string): { available: boolean; reason?: string } {
    const v = validateUsername(raw);
    if (v.ok === false) return { available: false, reason: v.error };
    if (this.byUsername.has(v.value) || this.reservedUsernames.has(v.value))
      return { available: false, reason: "이미 사용 중인 아이디예요" };
    return { available: true };
  }

  /**
   * 회원가입 — 유일성의 원자적 보장 지점.
   * 검증 → [동기 블록: 인덱스 확인 + 예약] → 영구 저장(비동기) → 실패 시 예약 해제.
   * 예약과 확인 사이에 await가 없으므로 동시 요청이 같은 아이디로 경쟁하면
   * 정확히 하나만 통과한다(A3).
   */
  async register(input: {
    username: unknown;
    email: unknown;
    password: unknown;
    profile: Partial<FitWire> | undefined;
  }): Promise<RegisterResult> {
    const u = validateUsername(input.username);
    if (u.ok === false) return { ok: false, status: 400, error: u.error };
    const e = validateEmail(input.email);
    if (e.ok === false) return { ok: false, status: 400, error: e.error };
    const p = validatePassword(input.password);
    if (p.ok === false) return { ok: false, status: 400, error: p.error };
    const wire = input.profile || {};
    if (!wire.fit) return { ok: false, status: 400, error: "스마트핏 프로필 누락" };

    // 프로세스 재시작 후 메모리가 비었을 때의 2차 방어 — Sheet 사전 확인.
    // (Sheet lookup만으로 유일성을 보장하지 않는다 — 아래 동기 예약이 1차 제약이다.)
    const existsInSheet = await this.persist.exists(u.value, e.value);
    if (existsInSheet) {
      return { ok: false, status: 409, error: "이미 사용 중인 아이디 또는 이메일이에요" };
    }

    // ── 원자적 예약 블록 (await 없음) ──
    if (this.byUsername.has(u.value) || this.reservedUsernames.has(u.value))
      return { ok: false, status: 409, error: "이미 사용 중인 아이디예요" };
    if (this.byEmail.has(e.value) || this.reservedEmails.has(e.value))
      return { ok: false, status: 409, error: "이미 가입된 이메일이에요" };
    this.reservedUsernames.add(u.value);
    this.reservedEmails.add(e.value);
    // ────────────────────────────────

    const account: Account = {
      username: u.value,
      email: e.value,
      hash: await hashPassword(String(input.password)),
      profile: {
        gender: String(wire.gender || "미지정"),
        size: String(wire.size || ""),
        fit: String(wire.fit),
      },
      createdAt: new Date().toISOString(),
      emailVerified: false, // §3 — 소유 확인 계약이 활성화될 때까지
    };

    try {
      await this.persist.create(account);
    } catch (err) {
      // 영구 저장 실패 — 예약을 되돌려 가입 가능 상태를 정직하게 유지한다
      this.reservedUsernames.delete(u.value);
      this.reservedEmails.delete(e.value);
      return { ok: false, status: 502, error: "회원 정보 저장에 실패했어요 — 잠시 후 다시 시도해 주세요" };
    }

    this.byUsername.set(u.value, account);
    this.byEmail.set(e.value, account);
    this.reservedUsernames.delete(u.value);
    this.reservedEmails.delete(e.value);
    return { ok: true, account };
  }

  /** 아이디 또는 이메일 로그인. 레거시 행은 username을 묶고 해시를 승격한다. */
  async login(
    idOrEmail: unknown,
    password: unknown,
  ): Promise<
    | { ok: true; account: Account; token: string }
    | { ok: false; status: number; error: string }
  > {
    const id = typeof idOrEmail === "string" ? idOrEmail.trim().toLowerCase() : "";
    const pw = typeof password === "string" ? password : "";
    if (!id || !pw) return { ok: false, status: 400, error: "아이디와 비밀번호를 입력해 주세요" };

    const account =
      this.byUsername.get(id) ?? this.byEmail.get(id) ?? null;
    if (!account) {
      // 메모리에 없으면(재시작) 영구 저장소 조회는 라우트 수준의 exists로만 가능 —
      // 세션 저장소 특성상 재시작 후 기존 계정 로그인은 Sheet 행 기반 라우트 폴백이 담당한다.
      return { ok: false, status: 401, error: "아이디 또는 비밀번호가 일치하지 않습니다" };
    }
    const verdict = await verifyPassword(pw, account.hash);
    if (verdict.ok === false) return { ok: false, status: 401, error: "아이디 또는 비밀번호가 일치하지 않습니다" };

    if (verdict.upgrade) {
      account.hash = verdict.upgrade;
      await this.persist.updateHash?.(account.email, verdict.upgrade);
    }
    const token = randomBytes(24).toString("base64url");
    this.sessions.set(token, account.email);
    return { ok: true, account, token };
  }

  sessionEmail(token: unknown): string | null {
    const t = typeof token === "string" ? token : "";
    return this.sessions.get(t) ?? null;
  }

  /** register 직후 로그인 없이 세션을 열기 위한 토큰 발급. */
  createSession(email: string): string {
    const token = newSessionToken();
    this.sessions.set(token, email);
    return token;
  }

  accountOf(token: unknown): Account | null {
    const email = this.sessionEmail(token);
    if (!email) return null;
    return this.byEmail.get(email) ?? null;
  }

  /** 프로필 갱신. reset=true는 핏 필드 공백화(§9 — 사용자 reset 권리, 시트 반영). */
  async updateProfile(
    token: unknown,
    profile: Partial<FitWire> | undefined,
    reset = false,
  ): Promise<{ ok: boolean; status?: number; error?: string; profile?: FitWire }> {
    const email = this.sessionEmail(token);
    if (!email) return { ok: false, status: 401, error: "로그인 필요" };
    const account = this.byEmail.get(email);
    if (!account) return { ok: false, status: 401, error: "로그인 필요" };

    const next: FitWire = reset
      ? { gender: account.profile.gender, size: "", fit: "" }
      : {
          gender: String(profile?.gender || account.profile.gender || "미지정"),
          size: String(profile?.size ?? account.profile.size ?? ""),
          fit: String(profile?.fit || account.profile.fit || ""),
        };
    account.profile = next;
    await this.persist.updateProfile?.(email, reset ? null : next);
    return { ok: true, profile: next };
  }

  /** 테스트·재시작 시딩용 — 영구 저장소에서 메모리로 적재(중복 행은 정직하게 거부).
   *  username이 빈 레거시 행(이메일 전용 가입)은 이메일 인덱스만 만든다 —
   *  없는 아이디를 지어내지 않는다. */
  seed(account: Account): boolean {
    if (this.byEmail.has(account.email)) return false;
    if (account.username) {
      if (this.byUsername.has(account.username)) return false;
      this.byUsername.set(account.username, account);
    }
    this.byEmail.set(account.email, account);
    return true;
  }
}

export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}
