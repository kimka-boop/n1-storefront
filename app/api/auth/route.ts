/**
 * [회원 API — Session A AUTH FOUNDATION + EMAIL VERIFY 활성] 아이디·이메일 회원가입/로그인 + 스마트핏 프로필
 * POST /api/auth
 *   { action: "check-username", username }              → 가용성 확인(가입 전 피드백)
 *   { action: "register", username, email, password,
 *     profile }                                          → 회원가입(대기 계정 생성 + 인증 메일 발송)
 *   { action: "login", id, password }                    → 로그인(아이디 또는 이메일; 미인증 계정 403 EMAIL_NOT_VERIFIED)
 *   { action: "profile", token, profile?, resetFitProfile? } → 핏 프로필 갱신/초기화
 *   { action: "resend-verification", email }             → 인증 메일 재발송(쿨다운 60s)
 *   { action: "change-pending-email", token | id+password,
 *     newEmail }                                         → 대기 계정 이메일 정정(구 토큰 무효 + 신주소 재발송)
 * GET  /api/auth?token=                                   → 세션/프로필 readback
 * GET  /api/auth/verify?token=                            → 인증 링크 확인(단일 사용·10분) — verify/route.ts
 *
 * 이메일 인증 (Session A §3 지연 계약의 해제 — lib/emailVerify.ts):
 *  - 모든 신규 가입은 인증 대기(이메일인증="인증대기")로 생성되고, 서버 토큰 확인으로만
 *    "확인"으로 승격된다. 클라이언트 플래그는 어디에도 신뢰되지 않는다.
 *  - 토큰은 32B 랜덤, 저장소(lib/authSheets Email_Verifications)에는 sha256 해시만 기록된다.
 *  - 레거시 회원("미확인")은 grandfathered — 로그인 게이트는 신규(대기) 계정에만 적용된다.
 *
 * 유일성: 프로세스 내 예약 인덱스(원자적) 1차 + Sheet 사전 확인 2차 방어.
 * 비밀번호: scrypt 해시만 저장 — 평문은 시트·로그·응답 어디에도 남지 않는다.
 */
import { NextResponse } from "next/server";
import {
  AuthStore,
  normalizeUsername,
  validateEmail,
} from "@/lib/authServer";
import {
  VERIFY_PURPOSE_SIGNUP,
  buildVerifyUrl,
  issueVerifyToken,
  resendAllowed,
} from "@/lib/emailVerify";
import { resolveEmailProvider } from "@/lib/emailProvider";
import { ensureStore, getVerificationStore } from "@/lib/authSheets";
import { RESET_FIT_PROFILE_FLAG } from "@/lib/fitContext";
import { logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

/* ── 인증 메일 발송 — provider 경계의 유일한 호출 지점 ── */

function requestOrigin(req: Request): string {
  if (process.env.N1_PUBLIC_BASE_URL) return process.env.N1_PUBLIC_BASE_URL.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

interface DispatchResult {
  sent: boolean;
  delivery: "sent" | "bridge" | null;
  code: string | null;
  message: string | null;
}

async function dispatchSignupVerification(
  store: AuthStore,
  email: string,
  origin: string,
): Promise<DispatchResult> {
  const { provider } = resolveEmailProvider();
  const vstore = await getVerificationStore();
  const cooldown = await resendAllowed(vstore, email, VERIFY_PURPOSE_SIGNUP);
  if (!cooldown.allowed) {
    return {
      sent: false,
      delivery: null,
      code: "VERIFY_RESEND_COOLDOWN",
      message: `잠시 후 다시 시도해 주세요 (${cooldown.retryAfterSeconds}초)`,
    };
  }
  const rawToken = await issueVerifyToken(vstore, email, VERIFY_PURPOSE_SIGNUP);
  const account = store.accountByEmail(email);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const result = await provider.sendVerificationEmail({
    to: email,
    username: account?.username || undefined,
    verifyUrl: buildVerifyUrl(origin, rawToken),
    expiresAt,
  });
  if (result.ok) {
    return { sent: true, delivery: result.delivery ?? null, code: null, message: null };
  }
  return { sent: false, delivery: null, code: result.code || "EMAIL_SEND_FAILED", message: result.message || null };
}

const bad = (error: string, status: number, code?: string) =>
  NextResponse.json(code ? { ok: false, code, error } : { ok: false, error }, { status });

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

    /* ═══ 회원가입 — 대기 계정 생성 + 인증 메일 발송(정책: 인증 필수) ═══ */
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
      // 이메일 인증 필수 — 발송 실패도 가입 자체를 무효로 하지 않는다(대기 상태 유지,
      // 재발송·이메일 정정으로 완결). 단, 응답은 정직하다: sent=false면 "보냈다"고 말하지 않는다.
      const dispatch = await dispatchSignupVerification(store, account.email, requestOrigin(req));
      return NextResponse.json({
        ok: true,
        token,
        email: account.email,
        username: account.username,
        profile: account.profile,
        emailVerified: account.emailVerified, // 항상 false — 확인은 서버 토큰 경로로만
        verificationRequired: account.verificationPending,
        verificationSent: dispatch.sent,
        verificationDelivery: dispatch.delivery,
        verificationCode: dispatch.code,
        verificationMessage: dispatch.message,
      });
    }

    /* ═══ 로그인 — 아이디 또는 이메일 (미인증 대기 계정 403 EMAIL_NOT_VERIFIED) ═══ */
    if (action === "login") {
      const id = String(body.id || body.email || body.username || "");
      const result = await store.login(id, body.password);
      if (result.ok === false) return bad(result.error, result.status, result.code);
      return NextResponse.json({
        ok: true,
        token: result.token,
        email: result.account.email,
        username: result.account.username,
        profile: result.account.profile,
        emailVerified: result.account.emailVerified,
        verificationRequired: result.account.verificationPending,
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

    /* ═══ 인증 메일 재발송 — 존재 유출 없는 균일 계약 (쿨다운 60s) ═══ */
    if (action === "resend-verification" || action === "request-email-verify") {
      const e = validateEmail(body.email);
      if (e.ok === false) return bad(e.error, 400);
      const account = store.accountByEmail(e.value);
      // 대상이 대기 계정일 때만 실발송 — 그 외에도 균일 ok 응답(계정 존재 유출 금지)
      if (account && account.verificationPending && !account.emailVerified) {
        const dispatch = await dispatchSignupVerification(store, account.email, requestOrigin(req));
        if (dispatch.code === "VERIFY_RESEND_COOLDOWN") {
          return bad(dispatch.message || "잠시 후 다시 시도해 주세요", 429, dispatch.code);
        }
        if (!dispatch.sent) {
          return bad(
            dispatch.message || "인증 메일 발송이 지연되고 있어요 — 잠시 후 다시 시도해 주세요",
            503,
            dispatch.code || "EMAIL_PROVIDER_NOT_CONFIGURED",
          );
        }
      }
      return NextResponse.json({
        ok: true,
        message: "요청이 접수됐어요 — 인증 메일이 오지 않으면 주소 스펠을 확인해 주세요",
      });
    }

    /* ═══ 대기 계정 이메일 정정 — 오타 복구 (재가입 강제 없음) ═══ */
    if (action === "change-pending-email") {
      const result = await store.changePendingEmail({
        sessionToken: body.token,
        idOrEmail: body.id,
        password: body.password,
        newEmail: body.newEmail,
      });
      if (result.ok === false) return bad(result.error, result.status, result.code);
      // 이전 주소의 미사용 토큰 명시 무효화 — 새 주소 발급(invalidateAll)은 새 주소에만 적용된다
      const vstore = await getVerificationStore();
      await vstore.invalidateAll(result.previousEmail, VERIFY_PURPOSE_SIGNUP);
      const dispatch = await dispatchSignupVerification(store, result.account.email, requestOrigin(req));
      return NextResponse.json({
        ok: true,
        email: result.account.email,
        verificationSent: dispatch.sent,
        verificationDelivery: dispatch.delivery,
        verificationCode: dispatch.code,
        verificationMessage: dispatch.message,
      });
    }

    return bad("알 수 없는 action", 400);
  } catch (e: unknown) {
    // 에러 응답에 요청 값(비밀번호 포함)을 절대 되돌려 주지 않는다(§2).
    logInternal("api/auth", e);
    return bad("서버 처리 중 문제가 발생했어요 — 잠시 후 다시 시도해 주세요", 500);
  }
}

export async function GET(req: Request) {
  try {
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
      verificationRequired: account.verificationPending,
    });
  } catch (e: unknown) {
    // [SESSION L · TASK 29] ensureStore(시트 접근) 실패가 핸들러 크래시(계약 밖 500)로
    // 이어지지 않게 한다 — ok:false 고정 문구로 정직 응답
    logInternal("api/auth", e);
    return bad("지금 계정 정보를 확인하지 못했어요 — 잠시 후 다시 시도해 주세요", 502);
  }
}
