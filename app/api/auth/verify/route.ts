/**
 * [이메일 인증 링크 확인] GET /api/auth/verify?token=
 *
 * 이메일의 인증 링크가 도착하는 유일한 서버 경로다. confirmVerifyToken이
 * 만료·단일 사용·목적·이메일 바인딩을 판정하고, 통과 시에만 markEmailVerified가
 * 이메일인증을 "확인"으로 승격한다. 클라이언트가 emailVerified=true를 제출할
 * 수 있는 경로는 존재하지 않는다.
 *
 * 응답은 브라우저(이메일 링크 클릭)를 위한 최소 HTML이다. 토큰은 응답·로그에
 * 남지 않는다(원문은 링크로만 존재, 저장소는 해시).
 */
import { NextResponse } from "next/server";
import { confirmVerifyToken, VERIFY_PURPOSE_SIGNUP } from "@/lib/emailVerify";
import { ensureStore, getVerificationStore } from "@/lib/authSheets";
import { logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

const PAGE_CSS = `
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#faf9f7;color:#1c1a17;font-family:'Pretendard',system-ui,-apple-system,sans-serif}
  .card{max-width:420px;margin:24px;padding:40px 36px;text-align:center;
    background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(28,26,23,.08)}
  .mark{font-size:13px;letter-spacing:.18em;color:#8a8378;margin-bottom:14px}
  h1{font-size:20px;font-weight:600;margin:0 0 10px}
  p{font-size:14px;line-height:1.65;color:#5c564d;margin:0 0 22px}
  a.btn{display:inline-block;padding:12px 28px;border-radius:999px;background:#1c1a17;
    color:#fff;text-decoration:none;font-size:14px}
`;

function page(title: string, body: string, showHomeLink: boolean): NextResponse {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — N°1</title><style>${PAGE_CSS}</style></head>
<body><div class="card"><p class="mark">N°1</p><h1>${title}</h1><p>${body}</p>
${showHomeLink ? '<a class="btn" href="/">N°1로 이동</a>' : ""}</div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    const store = await ensureStore();
    const vstore = await getVerificationStore();
    const verdict = await confirmVerifyToken(vstore, token, VERIFY_PURPOSE_SIGNUP);
    if (verdict.ok === false) {
      // 만료/재사용/불일치 — 각각 다음 행동을 알려주는 정직한 안내
      if (verdict.code === "VERIFY_TOKEN_EXPIRED") {
        return page(
          "링크가 만료됐어요",
          "인증 링크는 10분 동안만 유효해요. N°1에서 로그인을 시도하거나 고객센터로 연락 주시면 인증 메일을 다시 보내드릴게요.",
          false,
        );
      }
      if (verdict.code === "VERIFY_TOKEN_USED") {
        return page(
          "이미 인증된 링크예요",
          "이 링크는 이미 사용됐어요. 같은 계정의 인증은 한 번만 필요합니다 — 로그인이 되지 않으면 고객센터로 연락 주세요.",
          true,
        );
      }
      return page(
        "링크를 확인하지 못했어요",
        "인증 링크가 올바르지 않아요. 메일을 전체 복사해서 다시 열어 보시거나, 인증 메일을 새로 요청해 주세요.",
        false,
      );
    }
    const account = await store.markEmailVerified(verdict.email);
    if (!account) {
      // 토큰은 유효했으나 계정 행이 없는 비정상 상태 — 정직하게 안내 (내부 원문 노출 금지)
      return page(
        "계정을 찾지 못했어요",
        "인증 토큰은 유효하지만 계정 정보를 찾지 못했어요. 고객센터로 연락 주시면 바로 도와드릴게요.",
        false,
      );
    }
    return page(
      "이메일 인증이 완료되었어요",
      "이제 N°1의 완전한 회원이에요. 가입하신 아이디 또는 이메일로 로그인해 주세요.",
      true,
    );
  } catch (e) {
    logInternal("api/auth/verify", e);
    return page("확인하지 못했어요", "일시적인 문제예요 — 잠시 후 다시 시도해 주세요.", false);
  }
}
