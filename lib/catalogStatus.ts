/**
 * [CATALOG SERVING GATE — Recovery Mission §13·Owner Decision B/C 2026-09-16]
 * 카탈로그 검역 상태의 스토어프론트 강제. fail-closed: 값이 정확히 APPROVED_FOR_SERVING이
 * 아니면(미설정 포함) 서빙·구매를 허용하지 않는다 — 승인은 명시적 행위(set env + 재배포)다.
 *
 * 승인 절차 (N1_CATALOG_STATUS.json 승인 권한과 동일 — Human Owner 단독):
 *   1. Vercel env에 NEXT_PUBLIC_CATALOG_STATUS=APPROVED_FOR_SERVING 설정
 *   2. 재배포 (client 번들 인라인 + server runtime 동시 반영)
 *   3. mission-20260909/N1_CATALOG_STATUS.json 상태 갱신 (SSOT 일치)
 * 차단 절차: 값을 임의 값으로 되돌리거나 삭제 후 재배포.
 */
export const CATALOG_SERVING_APPROVED: boolean =
  process.env.NEXT_PUBLIC_CATALOG_STATUS === "APPROVED_FOR_SERVING";

export const CATALOG_QUARANTINED_MESSAGE =
  "상품 준비 중이에요 — 컬렉션을 다시 준비하고 있어요. 잠시 후 다시 열어봐 주세요.";
