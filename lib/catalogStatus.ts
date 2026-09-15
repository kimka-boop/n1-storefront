/**
 * [CATALOG STATUS — canonicalized per Owner directive 2026-09-16 §3]
 *
 * SERVER AUTHORITATIVE: `N1_CATALOG_STATUS` (server runtime env) — 주문·결제 게이트의 유일 권위.
 * `NEXT_PUBLIC_CATALOG_STATUS`는 고객 표시용 mirror일 뿐이며 게이트 권위가 아니다.
 * 두 값이 모두 설정됐는데 불일치하면 CATALOG_STATUS_DRIFT → fail-closed(주문 거절).
 *
 * fail-closed 불변: 권위 값이 정확히 APPROVED_FOR_SERVING이 아니면(미설정 포함) 서빙 불가.
 * 승인 절차: (1) Vercel에 N1_CATALOG_STATUS=APPROVED_FOR_SERVING 설정
 *           (2) NEXT_PUBLIC_CATALOG_STATUS mirror 동일값 설정 + 재배포(클라이언트 인라인 갱신)
 *           (3) mission-20260909/N1_CATALOG_STATUS.json SSOT 갱신 — 3원 일치(health check가 검사)
 */

/** 게이트 권위 — 서버 전용. undefined면 미설정(기본 검역 = 차단). */
export function catalogStatusAuthoritative(): string | undefined {
  return process.env.N1_CATALOG_STATUS;
}

/** 권위 값과 표시 mirror의 불일치 — drift 중이면 serving fail-closed. */
export function catalogStatusDrift(): boolean {
  const a = process.env.N1_CATALOG_STATUS;
  const m = process.env.NEXT_PUBLIC_CATALOG_STATUS;
  if (a === undefined && m === undefined) return false; // 둘 다 미설정 = 기본 검역, drift 아님
  return a !== m;
}

/** 주문 게이트 판정 — 서버 권위 + drift fail-closed. */
export function catalogServingApproved(): boolean {
  return catalogStatusAuthoritative() === "APPROVED_FOR_SERVING" && !catalogStatusDrift();
}

export const CATALOG_QUARANTINED_MESSAGE =
  "상품 준비 중이에요 — 컬렉션을 다시 준비하고 있어요. 잠시 후 다시 열어봐 주세요.";

/** 고객 표시용 mirror — 클라이언트 번들 빌드 타임 인라인. 게이트 권위 아님(§3). */
export const CATALOG_SERVING_MIRROR: boolean =
  process.env.NEXT_PUBLIC_CATALOG_STATUS === "APPROVED_FOR_SERVING";
