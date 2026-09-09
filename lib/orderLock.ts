/**
 * N°1 Order Lock — 주문 생성 임계구역 직렬화 (미션 §10 경합 방어)
 *
 * 문제: 마지막 1개 재고에 고객 A·B가 동시 결제 → 두 요청 모두 "검사 통과" 후 차감에 들어가면
 *       둘 다 주문이 확정될 수 있다 (검사와 차감 사이 창).
 *
 * 전략 (공급사 제약을 정직하게 반영):
 * - 도매꾹 OpenAPI는 원자적 예약(reserve) API를 제공하지 않는다 → 공급사 레벨 예약은 불가능.
 * - 우리가 통제하는 영역에서 검사(finalStockCheck)→주문 인입→Stock_Staging 차감을
 *   **한 임계구역으로 직렬화**한다. 단일 인스턴스 배포(supervisor 1프로세스)에서 이 락은
 *   창을 닫는다.
 * - 다중 인스턴스로 확장될 경우의 한계는 문서로 남긴다(한계 고지 의무):
 *   시트 멱등키(중복 생성 방어) + 차감 0 클램트 + 공급처 재검증 cadence가 최종 수렴 계약.
 * - 락 대기 시간 상한이 있다 — 시트 I/O 지연이 주문 전체를 매달리게 하지 않는다(초과 시 실패,
 *   고객은 재시도 가능. Session L 위생 계약 유지).
 */

interface LockEntry {
  promise: Promise<unknown>;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __n1_order_lock: LockEntry | undefined;
}

export const ORDER_LOCK_TIMEOUT_MS = 15_000;

/** 전역 주문 락 — 임계구역을 직렬화한다. 대기 초과 시 throw (호출자가 502 위생 계약으로 처리) */
export async function withOrderLock<T>(run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  // 기존 락이 풀릴 때까지 대기 (풀림 감지 = 참조가 바뀜)
  while (global.__n1_order_lock) {
    if (Date.now() - start > ORDER_LOCK_TIMEOUT_MS) {
      throw Object.assign(new Error("주문 처리가 잠시 지연되고 있습니다 — 잠시 후 다시 시도해 주세요"), {
        status: 503,
      });
    }
    const entry = global.__n1_order_lock;
    await entry.promise.catch(() => {}); // 선행 실행의 실패와 무관하게 락 해제를 기다린다
    if (global.__n1_order_lock === entry) {
      // 선행 실행이 아직 자기 자리를 안 정리했으면 다음 틱에 재확인
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry: LockEntry = { promise, createdAt: Date.now() };
  global.__n1_order_lock = entry;
  try {
    return await run();
  } finally {
    if (global.__n1_order_lock === entry) global.__n1_order_lock = undefined;
    release();
  }
}

/** 테스트용 — 락 상태 초기화 */
export function resetOrderLock(): void {
  global.__n1_order_lock = undefined;
}
