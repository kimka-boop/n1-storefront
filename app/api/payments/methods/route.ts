/**
 * [세이브드 결제 수단 — PG 관리 빌링키] /api/payments/methods
 *
 * POST { action: "register-init", token }
 *   → PG 등록 위젯 발급. pre-PG: 503 PAYMENT_PROVIDER_NOT_CONFIGURED (정직).
 * POST { action: "register-complete", token, registration_ref }
 *   → 서버→PG 재조회로 등록 확정(클라이언트 응답의 카드 정보는 존재하지도 않고 신뢰되지도 않는다)
 *     → Payment_Methods 시트에 PG 관리 빌링키+표시 메타데이터만 저장.
 * GET  ?token=                    → 본인 결제 수단 목록(표시 프로젝션 — 빌링키 미포함)
 * POST { action: "delete", token, method_id }
 *   → 소유자 일치 확인 후 상태 DELETED (+ PG 측 폐기, best-effort)
 *
 * 절대 계약 (lib/savedPayments.ts):
 *  - raw 카드 데이터는 어느 경로에도 존재하지 않는다 — 등록은 PG 위젯에서 일어난다.
 *  - 모든 조회·삭제는 세션 이메일 소유자 일치가 필요하다 (method_id 단독 불충분).
 *  - member 전용: token(세션) 필수 — 세션이 없으면 401.
 */
import { NextResponse } from "next/server";
import { getDoc } from "@/lib/sheets";
import { ensureStore } from "@/lib/authSheets";
import { resolvePaymentProvider } from "@/lib/paymentProvider";
import {
  createSavedMethod,
  findMethodsByOwner,
  findOwnedMethod,
  markMethodDeleted,
  toDisplay,
} from "@/lib/savedPayments";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

const pgPreparing = () =>
  NextResponse.json(
    {
      ok: false,
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      error: "카드 등록은 결제 시스템 연결 후 이용할 수 있어요 — 조금만 기다려 주세요",
    },
    { status: 503 },
  );

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
    const store = await ensureStore();
    const account = store.accountOf(token);
    if (!account) return NextResponse.json({ ok: false, error: "세션 만료" }, { status: 401 });

    const doc = await getDoc();
    const methods = await findMethodsByOwner(doc, account.email);
    const { savedMethodsAvailable } = resolvePaymentProvider();
    return NextResponse.json({
      ok: true,
      saved_methods_available: savedMethodsAvailable,
      methods: methods.map(toDisplay),
    });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/payments/methods GET", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const token = body?.token;
    if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
    const store = await ensureStore();
    const account = store.accountOf(token);
    if (!account) return NextResponse.json({ ok: false, error: "세션 만료" }, { status: 401 });

    const { provider, savedMethodsAvailable } = resolvePaymentProvider();

    if (action === "register-init") {
      if (!savedMethodsAvailable || !provider.createBillingKeyRegistration) return pgPreparing();
      const result = await provider.createBillingKeyRegistration({
        member: { email: account.email, customer_name: account.username || undefined },
      });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, code: result.code || "REGISTER_INIT_FAILED", error: result.customer_message || "카드 등록을 시작하지 못했어요" },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        provider: result.provider,
        registration_url: result.registration_url,
        registration_ref: result.registration_ref,
      });
    }

    if (action === "register-complete") {
      if (!savedMethodsAvailable || !provider.verifyBillingKeyRegistration) return pgPreparing();
      const registrationRef = String(body?.registration_ref || "").trim();
      if (!registrationRef) {
        return NextResponse.json({ ok: false, code: "REGISTRATION_REF_MISSING", error: "등록 참조가 없어요" }, { status: 400 });
      }
      // 단일 진실은 PG 재조회 응답이다 — 클라이언트가 준 카드 데이터는 애초에 존재하지 않는다
      const verdict = await provider.verifyBillingKeyRegistration({
        registration_ref: registrationRef,
        member_email: account.email,
      });
      if (!verdict.ok || !verdict.provider_billing_key) {
        return NextResponse.json(
          { ok: false, code: verdict.code || "REGISTER_VERIFY_FAILED", error: verdict.customer_message || "카드 등록을 확인하지 못했어요" },
          { status: 502 },
        );
      }
      const doc = await getDoc();
      const saved = await createSavedMethod(doc, {
        email: account.email,
        provider: verdict.provider,
        providerBillingKey: verdict.provider_billing_key,
        cardCorp: verdict.card_corp,
        last4: verdict.last4,
      });
      if (!saved.ok) {
        return NextResponse.json({ ok: false, error: "결제 수단 저장에 실패했어요 — 잠시 후 다시 시도해 주세요" }, { status: 502 });
      }
      return NextResponse.json({ ok: true, method: toDisplay(saved.method) });
    }

    if (action === "delete") {
      const methodId = String(body?.method_id || "").trim();
      if (!methodId) return NextResponse.json({ ok: false, error: "method_id 누락" }, { status: 400 });
      const doc = await getDoc();
      // 소유자 일치가 확인된 ACTIVE 수단만 — method_id 단독으로는 삭제되지 않는다
      const owned = await findOwnedMethod(doc, account.email, methodId);
      if (!owned) return NextResponse.json({ ok: false, error: "결제 수단을 찾을 수 없어요" }, { status: 404 });
      // PG 측 빌링키 폐기 — 실패해도 로컬 삭제는 진행한다(사용 불가 상태로 남기고 정리는 운영이)
      if (provider.deleteBillingKey) {
        try {
          await provider.deleteBillingKey({ provider_billing_key: owned.providerBillingKey });
        } catch {
          // best-effort
        }
      }
      const done = await markMethodDeleted(doc, account.email, methodId);
      if (!done) return NextResponse.json({ ok: false, error: "삭제에 실패했어요 — 잠시 후 다시 시도해 주세요" }, { status: 502 });
      return NextResponse.json({ ok: true, method_id: methodId });
    }

    return NextResponse.json({ ok: false, error: "알 수 없는 action" }, { status: 400 });
  } catch (e: unknown) {
    const failure = clientSafeFailure(e);
    if (failure.status >= 500) logInternal("api/payments/methods POST", e);
    return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
  }
}
