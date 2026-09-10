/**
 * EMAIL VERIFY — 이메일 소유 확인 (Session A §3 지연 계약의 해제, 2026-09-10)
 *
 * 전환 배경: Session A는 transactional email provider 부재로 소유 확인을
 * EMAIL_VERIFY_DEFERRED로 지연하고, 해제 조건 4항을 이 파일에 명문화했다.
 * 본 구현은 그 조건을 그대로 이행한다:
 *  1. provider는 env 주입(lib/emailProvider.ts) — 소스에 credential literal 없음.
 *  2. requestEmailVerify / confirmEmailVerify가 실동작으로 교체 — 계약 시그니처 유지.
 *  3. 단일사용 토큰(10분 만료) 검증 → Account.emailVerified=true 승격.
 *  4. 비밀번호 recovery는 이 확인이 열린 이후 별도 구현으로만 연다 (본 미션 범위 밖).
 *
 * 토큰 보안 계약:
 *  - 32B crypto.randomBytes → base64url (예측 불가). 원문은 이메일 링크로만 존재.
 *  - 저장소에는 sha256 해시만 기록 — 유출된 시트로는 링크를 재구성할 수 없다.
 *  - 만료(10분) + 단일 사용 + 목적 바인딩("signup") + 이메일 바인딩.
 *  - 재발송은 이메일당 쿨다운 — 발송 남용·시트 비대 방지.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** 지연 계약에서 명시한 만료 — 10분 */
export const VERIFY_TOKEN_TTL_MINUTES = 10;
/** 재발송 쿨다운 — 발송 남용 방지 (초) */
export const VERIFY_RESEND_COOLDOWN_SECONDS = 60;
/** 목적 바인딩 — 현재는 가입 확인 하나만 존재한다 */
export const VERIFY_PURPOSE_SIGNUP = "signup" as const;
export type VerifyPurpose = typeof VERIFY_PURPOSE_SIGNUP;

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function newVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 영구 저장소 포트 — Sheets 구현은 라우트가 주입한다. 저장값은 항상 해시다. */
export interface VerificationRecord {
  tokenHash: string;
  email: string;
  purpose: VerifyPurpose;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface VerifyTokenStore {
  /** 새 토큰 레코드 적재 (해시만 저장). 같은 이메일+목적의 미사용 토큰은 무효화한다. */
  issue(record: VerificationRecord): Promise<void>;
  /** 해시로 레코드 조회 — 사용·무효화된 것도 포함(단일 사용 판정용), 없으면 null */
  find(tokenHash: string): Promise<VerificationRecord | null>;
  /** 단일 사용 확정 — usedAt이 비어 있을 때만 성공해야 한다(경합 방어는 구현 책임) */
  markUsed(tokenHash: string, usedAt: string): Promise<boolean>;
  /** 해당 이메일+목적의 미사용 토큰 전량 무효화 (이메일 수정·재발송 시) */
  invalidateAll(email: string, purpose: VerifyPurpose): Promise<void>;
  /** 쿨다운 판정용 — 이 이메일+목적의 가장 최근 발급 시각 (없으면 null) */
  lastIssuedAt(email: string, purpose: VerifyPurpose): Promise<string | null>;
}

export type ConfirmVerdict =
  | { ok: true; email: string }
  | { ok: false; code: "VERIFY_TOKEN_INVALID" | "VERIFY_TOKEN_EXPIRED" | "VERIFY_TOKEN_USED"; message: string };

/** 토큰 확인 — 만료→사용→바인딩 순 판정. raw token은 어디에도 저장되지 않는다. */
export async function confirmVerifyToken(
  store: VerifyTokenStore,
  rawToken: unknown,
  purpose: VerifyPurpose,
  now: Date = new Date(),
): Promise<ConfirmVerdict> {
  const raw = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!raw || raw.length < 20 || raw.length > 128) {
    return { ok: false, code: "VERIFY_TOKEN_INVALID", message: "인증 링크가 올바르지 않아요." };
  }
  const tokenHash = hashToken(raw);
  const record = await store.find(tokenHash);
  if (!record || record.purpose !== purpose) {
    return { ok: false, code: "VERIFY_TOKEN_INVALID", message: "인증 링크가 올바르지 않아요." };
  }
  // 사용(또는 무효화)된 토큰 — 만료 판정보다 먼저 정직하게 알린다
  if (record.usedAt) {
    return { ok: false, code: "VERIFY_TOKEN_USED", message: "이미 사용된 인증 링크예요." };
  }
  if (new Date(record.expiresAt).getTime() < now.getTime()) {
    return { ok: false, code: "VERIFY_TOKEN_EXPIRED", message: "인증 링크가 만료됐어요 — 인증 메일을 다시 보내 주세요." };
  }
  // markUsed의 재확인이 경합 방어선이다 — 동시 클릭이 와도 정확히 하나만 통과한다
  const claimed = await store.markUsed(tokenHash, now.toISOString());
  if (!claimed) {
    return { ok: false, code: "VERIFY_TOKEN_USED", message: "이미 사용된 인증 링크예요." };
  }
  // 이메일 바인딩 — 확인 성공은 이 토큰이 발급된 주소에만 적용된다
  return { ok: true, email: record.email };
}

/** 발급 가능 여부 — 쿨다운 판정 (정직한 잔여 대기시간 반환) */
export async function resendAllowed(
  store: VerifyTokenStore,
  email: string,
  purpose: VerifyPurpose,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const last = await store.lastIssuedAt(email, purpose);
  if (!last) return { allowed: true };
  const elapsed = (now.getTime() - new Date(last).getTime()) / 1000;
  if (elapsed >= VERIFY_RESEND_COOLDOWN_SECONDS) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil(VERIFY_RESEND_COOLDOWN_SECONDS - elapsed) };
}

/** 신규 토큰 발급 — 기존 미사용 토큰 무효화 후 적재. raw token은 호출자가 이메일로 전달. */
export async function issueVerifyToken(
  store: VerifyTokenStore,
  email: string,
  purpose: VerifyPurpose,
  now: Date = new Date(),
): Promise<string> {
  await store.invalidateAll(email, purpose);
  const raw = newVerifyToken();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + VERIFY_TOKEN_TTL_MINUTES * 60_000).toISOString();
  await store.issue({
    tokenHash: hashToken(raw),
    email,
    purpose,
    createdAt,
    expiresAt,
    usedAt: null,
  });
  return raw;
}

/* ── verifyUrl 조립 — 베이스는 설정값·요청 origin 뿐이다 (SSRF 계약: 사용자 입력 URL 금지) ── */

export function buildVerifyUrl(baseUrl: string, rawToken: string): string {
  const base = (baseUrl || "").replace(/\/+$/, "");
  return `${base}/api/auth/verify?token=${encodeURIComponent(rawToken)}`;
}

/** timingSafe 비교 유틸 — 해시 문자열 비교용 (이 모듈 내부 일관성 유지) */
export function safeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** 회원 탈퇴 시 스마트핏 개인화 프로필 처리 — 정책 초안(docs/N1_SMARTFIT_DATA_POLICY_DRAFT.md)과 짝을 이루는 코드 자리표.
 *  (Session A 때 이 파일에 놓였던 상수 — 이메일 모듈과 무관하지만 이동은 본 미션 범위 밖) */
export const SMARTFIT_ON_WITHDRAWAL = "DELETE_PERSONALIZATION_KEEP_ORDER_RECORDS" as const;
