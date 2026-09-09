/**
 * [게스트 주문 조회] Session C §10
 * POST /api/orders/lookup { order_id, phone }
 *
 * 소유 검증: 주문번호 + 연락처(숫자 정규화 후 완전 일치)가 모두 맞아야 소유자 뷰를 내려준다.
 * 주문번호만으로는 절대 PII를 노출하지 않는다 — 미존재와 불일치는 구분 없이
 * 동일한 generic 404 로 응답해 주문번호 존재 자체도 유출하지 않는다.
 * (CS 상담의 뒷자리 4자리 검증은 사람이 개입하는 별도 흐름 — 자가 조회는 전체 일치만 허용)
 */
import { NextResponse } from "next/server";
import { getDoc, findOrderById } from "@/lib/sheets";
import { projectOrderForOwner, verifyGuestOwnership, publicOrderProbeRejected } from "@/lib/orderView";
import { clientSafeFailure, logInternal } from "@/lib/errorSanitize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    const phone = String(body?.phone || "").trim();
    if (!orderId || !phone) {
      // 키 부족도 동일한 generic 응답 — 어떤 입력이 빠졌는지 힌트를 주지 않는다
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }
    const doc = await getDoc();
    const record = await findOrderById(doc, orderId);
    // 미존재 / 소유 불일치 → 구분 없는 동일 응답 (존재 유출 없음)
    if (!record || !verifyGuestOwnership(record, phone)) {
      return NextResponse.json(publicOrderProbeRejected(), { status: 404 });
    }
    return NextResponse.json({ ok: true, order: projectOrderForOwner(record) });
  } catch (e: unknown) {
    // [SESSION L] 시트 실패가 generic 404로 위장하지 않게 한다 — 고정 문구 + 502로
    // "조회 불가"와 "없음"을 구분한다 (존재 유출 방지 디사이플린 유지)
    logInternal("api/orders/lookup", e);
    return NextResponse.json(
      { ok: false, error: "지금 주문 조회가 되지 않아요 — 잠시 후 다시 시도해 주세요" },
      { status: 502 },
    );
  }
}
